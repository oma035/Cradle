// The escrow lifecycle of a paid expert review:
//   awaiting_approval -> (mother approves) paying -> paid -> claimed (by expert)
//   -> paying_out -> answered          ...or paid/claimed -> refunding -> refunded (timeout)
import { config, txLink } from "./config.js";
import { decryptSecret, randomToken } from "./secrets.js";
import { balances, sendUsdc, treasury } from "./stellar.js";
import { payForReview } from "./x402-client.js";
import { REVIEW_ROUTE } from "./x402-server.js";
import { pretty, shareOf, toStroops } from "./money.js";

export function makeReviews(db, notify) {
  return {
    /** Mother pressed Approve. Pays the x402 endpoint from her wallet into escrow. */
    async approveAndPay(questionId, telegramId) {
      const q = db.question(questionId);
      const user = q && db.userById(q.user_id);
      if (!q || !user || user.telegram_id !== String(telegramId)) return { ok: false, msg: "Question not found." };
      if (!user.public_key) return { ok: false, msg: "You need a wallet first. Send /create." };

      const nonce = randomToken(12);
      if (!db.transition(q.id, ["awaiting_approval", "failed"], "paying", { pay_nonce: nonce, error: null })) {
        return { ok: false, msg: "This request was already handled." };
      }

      try {
        const bal = await balances(user.public_key);
        if (!bal.hasTrustline || toStroops(bal.usdc) < toStroops(q.price_usd)) {
          db.transition(q.id, ["paying"], "awaiting_approval");
          return {
            ok: false,
            retry: true,
            msg:
              `Your wallet has ${pretty(bal.usdc)} USDC but this review costs ${pretty(q.price_usd)}.\n` +
              `Top up your wallet (send /wallet for your address), then tap Approve again.`,
          };
        }

        const secret = decryptSecret(user.enc_secret, config.masterKey);
        const url = `http://127.0.0.1:${config.port}${REVIEW_ROUTE}`;
        const { body, txHash } = await payForReview(secret, url, { questionId: q.id, nonce });

        db.transition(q.id, ["paying"], "paid", { payment_tx: txHash, paid_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
        db.logPayment({
          question_id: q.id, kind: "x402_in", from_address: user.public_key,
          to_address: treasury().publicKey(), amount: q.price_usd, tx_hash: txHash,
        });
        return { ok: true, ticket: body.ticket, txHash };
      } catch (err) {
        console.error("[pay]", err);
        db.transition(q.id, ["paying"], "failed", { error: String(err.message).slice(0, 500) });
        return { ok: false, retry: true, msg: "The payment didn't go through, and you were not charged. Please tap Approve to try again." };
      }
    },

    decline(questionId, telegramId) {
      const q = db.question(questionId);
      const user = q && db.userById(q.user_id);
      if (!q || !user || user.telegram_id !== String(telegramId)) return false;
      return db.transition(q.id, ["awaiting_approval", "failed"], "declined");
    },

    claim(questionId, expert) {
      return db.transition(questionId, ["paid"], "claimed", { expert_id: expert.id });
    },

    /** Expert submits an answer: pay the expert from escrow, then deliver answer + receipts to the mother. */
    async answer(questionId, expert, answerText) {
      const q = db.question(questionId);
      if (!q || q.expert_id !== expert.id) return { ok: false, msg: "Claim this question first." };
      if (!db.transition(q.id, ["claimed"], "paying_out", { expert_answer: answerText })) {
        return { ok: false, msg: "This question is no longer open." };
      }
      const amount = shareOf(q.price_usd, config.expertSharePercent);
      let payoutTx = null;
      try {
        payoutTx = await sendUsdc(treasury(), expert.stellar_address, amount, `Cradle CRD-${q.id}`);
        db.logPayment({
          question_id: q.id, kind: "payout", from_address: treasury().publicKey(),
          to_address: expert.stellar_address, amount, tx_hash: payoutTx,
        });
      } catch (err) {
        console.error("[payout]", err);
        db.update(q.id, { status: "payout_failed", error: String(err.message).slice(0, 500) });
        await this.deliver(q.id, expert); // she still gets her answer; admin retries the payout
        return { ok: true, payoutFailed: true, msg: "Answer delivered. The payout failed and will be retried by the admin." };
      }
      db.transition(q.id, ["paying_out"], "answered", {
        payout_tx: payoutTx, payout_amount: amount,
        answered_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      await this.deliver(q.id, expert);
      return { ok: true, payoutTx, amount };
    },

    async retryPayout(questionId) {
      const q = db.question(questionId);
      const expert = q && db.expertById(q.expert_id);
      if (!q || !expert || !db.transition(q.id, ["payout_failed"], "paying_out")) return { ok: false };
      const amount = shareOf(q.price_usd, config.expertSharePercent);
      try {
        const payoutTx = await sendUsdc(treasury(), expert.stellar_address, amount, `Cradle CRD-${q.id}`);
        db.logPayment({ question_id: q.id, kind: "payout", from_address: treasury().publicKey(), to_address: expert.stellar_address, amount, tx_hash: payoutTx });
        db.transition(q.id, ["paying_out"], "answered", { payout_tx: payoutTx, payout_amount: amount, error: null });
        return { ok: true, payoutTx };
      } catch (err) {
        db.update(q.id, { status: "payout_failed", error: String(err.message).slice(0, 500) });
        return { ok: false, msg: err.message };
      }
    },

    async deliver(questionId, expert) {
      const q = db.question(questionId);
      const user = db.userById(q.user_id);
      const lines = [
        `👩🏾‍⚕️ <b>Midwife review: ticket CRD-${q.id}</b>`,
        "",
        escapeHtml(q.expert_answer),
        "",
        `— ${escapeHtml(expert.name)}${expert.profession ? `, ${escapeHtml(expert.profession)}` : ""}`,
        "",
        "🧾 <b>Receipt</b>",
        `Paid: ${pretty(q.price_usd)} USDC from your wallet to Cradle escrow`,
        q.payment_tx ? `<a href="${txLink(q.payment_tx)}">View payment on Stellar</a>` : "",
        q.payout_tx ? `Expert paid: ${pretty(q.payout_amount)} USDC to ${escapeHtml(expert.name)}\n<a href="${txLink(q.payout_tx)}">View payout on Stellar</a>` : "Expert payout: processing",
        "",
        "<i>This is general guidance, not a diagnosis. If anything gets worse, go to a clinic or hospital.</i>",
      ];
      await notify(user.telegram_id, lines.filter((l) => l !== null).join("\n"));
    },

    /** Refunds mothers whose paid questions were not answered in time. Runs on a timer. */
    async refundOverdue() {
      for (const q of db.overdueReviews(config.reviewTimeoutMinutes)) {
        if (!db.transition(q.id, ["paid", "claimed"], "refunding")) continue;
        const user = db.userById(q.user_id);
        try {
          const tx = await sendUsdc(treasury(), user.public_key, q.price_usd, `Cradle refund CRD-${q.id}`);
          db.transition(q.id, ["refunding"], "refunded", { refund_tx: tx });
          db.logPayment({ question_id: q.id, kind: "refund", from_address: treasury().publicKey(), to_address: user.public_key, amount: q.price_usd, tx_hash: tx });
          await notify(
            user.telegram_id,
            `😔 No midwife was available for ticket CRD-${q.id} in time, so we refunded ${pretty(q.price_usd)} USDC to your wallet.\n` +
              `<a href="${txLink(tx)}">View refund on Stellar</a>\n\nYou can ask again any time.`
          );
        } catch (err) {
          console.error("[refund]", err);
          db.update(q.id, { status: q.status, error: `refund failed: ${String(err.message).slice(0, 400)}` });
        }
      }
    },
  };
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
