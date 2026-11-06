// Cradle's Telegram conversation: /start, /create, /wallet, questions, approve/decline.
import { config, accountLink, txLink } from "./config.js";
import { triage } from "./agent.js";
import { emergencyMessage } from "./redflags.js";
import { encryptSecret } from "./secrets.js";
import { balances, createSponsoredWallet } from "./stellar.js";
import { escapeHtml } from "./reviews.js";
import { pretty } from "./money.js";

const DISCLAIMER = "<i>Cradle gives general guidance, not a diagnosis. It does not replace a doctor, midwife or clinic.</i>";

export function makeBot(db, tg, reviews) {
  const busy = new Set(); // one request at a time per user

  async function onStart(chatId, user) {
    await tg.send(
      chatId,
      `Hello${user.telegram_name ? ` ${escapeHtml(user.telegram_name)}` : ""} 👋🏾 I'm <b>Cradle</b>.\n\n` +
        "Ask me anything about your pregnancy or your new baby, in your own words. For example:\n" +
        "<i>“I'm 30 weeks and my feet are swelling, is that normal?”</i>\n\n" +
        "• Simple questions are answered <b>free</b>.\n" +
        `• If you need a real midwife to look at it, I'll ask your permission first. It costs <b>${pretty(config.reviewPriceUsd)}</b> in USDC, paid from your Cradle wallet.\n` +
        "• For danger signs I'll tell you to go to a hospital straight away.\n\n" +
        "Commands:\n/create: make your Cradle wallet\n/wallet: see your balance\n/help: how Cradle works\n\n" +
        DISCLAIMER
    );
  }

  async function onCreate(chatId, user) {
    if (user.public_key) {
      return tg.send(chatId, `You already have a Cradle wallet:\n<code>${user.public_key}</code>\n\nSend /wallet to see your balance.`);
    }
    await tg.send(chatId, "Creating your wallet on Stellar… ⏳");
    const w = await createSponsoredWallet();
    db.setUserWallet(user.id, w.publicKey, encryptSecret(w.secret, config.masterKey));
    await tg.send(
      chatId,
      "✅ <b>Your Cradle wallet is ready.</b>\n\n" +
        `Address (tap to copy):\n<code>${w.publicKey}</code>\n\n` +
        `To pay for midwife reviews, add <b>USDC on the Stellar network</b> to this address${config.isMainnet ? " (real money)" : " (testnet)"}.\n` +
        "Cradle covers the network fees for you, and every payment asks for your approval first.\n\n" +
        `<a href="${accountLink(w.publicKey)}">View on Stellar explorer</a>`
    );
  }

  async function onWallet(chatId, user) {
    if (!user.public_key) return tg.send(chatId, "You don't have a wallet yet. Send /create to make one.");
    const b = await balances(user.public_key);
    await tg.send(
      chatId,
      `💳 <b>Your Cradle wallet</b>\n<code>${user.public_key}</code>\n\n` +
        `Balance: <b>${pretty(b.usdc)} USDC</b>\n` +
        `One midwife review: ${pretty(config.reviewPriceUsd)}\n\n` +
        `<a href="${accountLink(user.public_key)}">View on Stellar explorer</a>`
    );
  }

  async function onQuestion(chatId, user, text) {
    await tg.typing(chatId);
    const t = await triage(text);

    if (t.triage === "emergency") {
      db.createQuestion({ user_id: user.id, text, triage: "emergency", ai_answer: t.answer, status: "emergency" });
      return tg.send(chatId, emergencyMessage(t.signs));
    }

    if (t.triage === "free") {
      db.createQuestion({ user_id: user.id, text, triage: "free", ai_answer: t.answer, status: "answered_free" });
      return tg.send(chatId, `${escapeHtml(t.answer)}\n\n💚 This answer was free.\n${DISCLAIMER}`);
    }

    const id = db.createQuestion({
      user_id: user.id, text, triage: "expert", ai_answer: `${t.answer}\n\n[agent note] ${t.reason}`,
      status: "awaiting_approval", price_usd: config.reviewPriceUsd,
    });
    await tg.send(
      chatId,
      `${escapeHtml(t.answer)}\n\n` +
        `👩🏾‍⚕️ I think a <b>midwife</b> should review this. It costs <b>${pretty(config.reviewPriceUsd)} USDC</b> from your Cradle wallet.\n` +
        "If no midwife answers in time, you get your money back automatically.\n\n" +
        (user.public_key ? "Do you want to go ahead?" : "First send /create to make your wallet, then tap Approve."),
      { reply_markup: approvalButtons(id) }
    );
  }

  async function onCallback(cb) {
    const chatId = cb.message.chat.id;
    const [action, rawId] = String(cb.data || "").split(":");
    const id = Number(rawId);
    if (action === "decline") {
      await tg.answerCallback(cb.id, "Declined");
      await tg.clearButtons(chatId, cb.message.message_id);
      if (reviews.decline(id, cb.from.id)) await tg.send(chatId, "No problem, nothing was paid. You can ask me something else any time.");
      return;
    }
    if (action !== "approve") return tg.answerCallback(cb.id);

    if (busy.has(cb.from.id)) return tg.answerCallback(cb.id, "Already working on it…");
    busy.add(cb.from.id);
    try {
      await tg.answerCallback(cb.id, "Paying…");
      await tg.clearButtons(chatId, cb.message.message_id);
      await tg.send(chatId, "💸 Paying the midwife review service on Stellar…");
      const r = await reviews.approveAndPay(id, cb.from.id);
      if (r.ok) {
        await tg.send(
          chatId,
          `✅ <b>Paid ${pretty(config.reviewPriceUsd)} USDC</b>. Your ticket is <b>${r.ticket}</b>.\n` +
            "A verified midwife will reply right here. I'll send you a receipt with the answer.\n" +
            (r.txHash ? `<a href="${txLink(r.txHash)}">View payment on Stellar</a>` : "")
        );
      } else {
        await tg.send(chatId, escapeHtml(r.msg), r.retry ? { reply_markup: approvalButtons(id) } : {});
      }
    } finally {
      busy.delete(cb.from.id);
    }
  }

  return async function onUpdate(update) {
    if (update.callback_query) return onCallback(update.callback_query);
    const msg = update.message;
    if (!msg?.text || msg.chat.type !== "private") return;

    const chatId = msg.chat.id;
    const user = db.upsertUser(msg.from.id, msg.from.first_name);
    const text = msg.text.trim();
    const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : null;

    if (busy.has(msg.from.id)) return tg.send(chatId, "One moment, I'm still working on your last message…");
    busy.add(msg.from.id);
    try {
      if (cmd === "/start" || cmd === "/help") return await onStart(chatId, user);
      if (cmd === "/create") return await onCreate(chatId, user);
      if (cmd === "/wallet") return await onWallet(chatId, user);
      if (cmd) return await tg.send(chatId, "I don't know that command. Try /help.");
      return await onQuestion(chatId, user, text);
    } catch (err) {
      console.error("[bot]", err);
      await tg.send(chatId, "Sorry, something went wrong on my side. Please try again in a minute. If this is urgent, go to a clinic.");
    } finally {
      busy.delete(msg.from.id);
    }
  };
}

function approvalButtons(id) {
  return {
    inline_keyboard: [[
      { text: `✅ Approve ${pretty(config.reviewPriceUsd)}`, callback_data: `approve:${id}` },
      { text: "❌ Decline", callback_data: `decline:${id}` },
    ]],
  };
}
