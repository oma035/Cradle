// Swaps XLM to USDC on the Stellar DEX for the Cradle treasury wallet.
//   node scripts/swap-xlm-to-usdc.js 40      -> shows a quote only (no money moves)
//   node scripts/swap-xlm-to-usdc.js 40 --yes -> performs the swap
import { Asset, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { config, txLink } from "../src/config.js";
import { balances, horizon, treasury, USDC } from "../src/stellar.js";

const amount = process.argv.slice(2).find((a) => /^\d+(\.\d{1,7})?$/.test(a));
const confirmed = process.argv.includes("--yes");
const SLIPPAGE = 0.01; // accept up to 1% worse than the quote
const KEEP_XLM = 20; // never let the treasury drop below this (fees + sponsoring wallets)

if (!amount) {
  console.log("Usage: node scripts/swap-xlm-to-usdc.js <XLM amount> [--yes]\nExample: node scripts/swap-xlm-to-usdc.js 40");
  process.exit(1);
}

const kp = treasury();
const before = await balances(kp.publicKey());
console.log(`\nWallet:  ${kp.publicKey()} (${config.networkName})`);
console.log(`Balance: ${before.xlm} XLM, ${before.usdc} USDC`);

if (!before.hasTrustline) {
  console.log("\nThis wallet has no USDC trustline. Run: npm run setup:treasury -- --trust");
  process.exit(1);
}
if (Number(before.xlm) - Number(amount) < KEEP_XLM) {
  console.log(`\nToo much: the wallet must keep at least ${KEEP_XLM} XLM for fees and new mother wallets.`);
  process.exit(1);
}

// Ask Horizon for the best route on the DEX.
const paths = await horizon.strictSendPaths(Asset.native(), String(amount), [USDC]).call();
if (!paths.records.length) {
  console.log("\nNo route found from XLM to USDC right now. Try again in a minute.");
  process.exit(1);
}
const best = paths.records.reduce((a, b) => (Number(b.destination_amount) > Number(a.destination_amount) ? b : a));
const quoted = Number(best.destination_amount);
const minOut = (quoted * (1 - SLIPPAGE)).toFixed(7);

console.log(`\nQuote:   ${amount} XLM -> about ${quoted.toFixed(4)} USDC`);
console.log(`Minimum: ${minOut} USDC (the swap cancels if the price moves more than 1%)`);

if (!confirmed) {
  console.log(`\nNothing was sent. To do the swap, run:\n  node scripts/swap-xlm-to-usdc.js ${amount} --yes\n`);
  process.exit(0);
}

const account = await horizon.loadAccount(kp.publicKey());
const tx = new TransactionBuilder(account, { fee: "10000", networkPassphrase: config.passphrase })
  .addOperation(
    Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(),
      sendAmount: String(amount),
      destination: kp.publicKey(),
      destAsset: USDC,
      destMin: minOut,
      path: best.path.map((p) => (p.asset_type === "native" ? Asset.native() : new Asset(p.asset_code, p.asset_issuer))),
    })
  )
  .setTimeout(60)
  .build();
tx.sign(kp);

try {
  const res = await horizon.submitTransaction(tx);
  const after = await balances(kp.publicKey());
  console.log(`\nSwap done ✅  ${txLink(res.hash)}`);
  console.log(`New balance: ${after.xlm} XLM, ${after.usdc} USDC\n`);
} catch (err) {
  const codes = err?.response?.data?.extras?.result_codes;
  console.log(`\nSwap failed: ${codes ? JSON.stringify(codes) : err.message}`);
  console.log("No money moved. If it says op_under_dest_min, the price moved: just run it again.");
  process.exit(1);
}
