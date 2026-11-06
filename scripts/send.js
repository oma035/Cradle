// Sends XLM or USDC from the Cradle treasury wallet.
//   node scripts/send.js usdc 1 GABC...           -> preview only (no money moves)
//   node scripts/send.js usdc 1 GABC... --yes     -> sends it
//   node scripts/send.js xlm 5 GABC... --memo 12345 --yes   (add a memo when sending to an exchange)
import { Asset, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { config, txLink, accountLink } from "../src/config.js";
import { balances, horizon, isValidAddress, treasury, USDC } from "../src/stellar.js";

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const memoIdx = args.indexOf("--memo");
const memo = memoIdx >= 0 ? args[memoIdx + 1] : null;
const positional = args.filter((a, i) => !a.startsWith("--") && !(memoIdx >= 0 && i === memoIdx + 1));
const [assetArg, amount, to] = positional;
const KEEP_XLM = 20; // treasury keeps this for fees and sponsoring mother wallets

function stop(msg) {
  console.log(`\n${msg}\n`);
  process.exit(1);
}

const asset = String(assetArg || "").toLowerCase();
if (!["xlm", "usdc"].includes(asset) || !/^\d+(\.\d{1,7})?$/.test(amount || "") || !to) {
  stop("Usage: node scripts/send.js <xlm|usdc> <amount> <destination G... address> [--memo TEXT] [--yes]\nExample: node scripts/send.js usdc 1 GABC...XYZ");
}
if (Number(amount) <= 0) stop("Amount must be more than 0.");
if (!isValidAddress(to)) stop("That destination address isn't a valid Stellar address (56 characters, starting with G).");
if (memo !== null && (!memo || Buffer.byteLength(memo) > 28)) stop("Memo must be 1 to 28 characters.");

const kp = treasury();
if (to === kp.publicKey()) stop("That's the treasury's own address.");

const from = await balances(kp.publicKey());
const dest = await balances(to);
const label = asset.toUpperCase();

console.log(`\nFrom:    ${kp.publicKey()} (treasury, ${config.networkName})`);
console.log(`         Balance: ${from.xlm} XLM, ${from.usdc} USDC`);
console.log(`To:      ${to}`);
console.log(`Amount:  ${amount} ${label}${memo ? `\nMemo:    ${memo}` : ""}`);

let op;
if (asset === "xlm") {
  if (Number(from.xlm) - Number(amount) < KEEP_XLM) stop(`Not enough XLM: the treasury must keep at least ${KEEP_XLM} XLM.`);
  if (!dest.exists) {
    if (Number(amount) < 1) stop("That address isn't active on Stellar yet. Send at least 1 XLM to activate it.");
    console.log("Note:    this address isn't active yet. This payment will create it.");
    op = Operation.createAccount({ destination: to, startingBalance: String(amount) });
  } else {
    op = Operation.payment({ destination: to, asset: Asset.native(), amount: String(amount) });
  }
} else {
  if (Number(from.usdc) < Number(amount)) stop(`Not enough USDC: the treasury has ${from.usdc}.`);
  if (!dest.exists) stop("That address isn't active on Stellar yet, so it can't receive USDC. Send it some XLM first.");
  if (!dest.hasTrustline) stop("That address has no USDC trustline, so it can't receive USDC. The owner must add USDC in their wallet app first.");
  op = Operation.payment({ destination: to, asset: USDC, amount: String(amount) });
}

if (!confirmed) {
  const extra = memo ? ` --memo ${memo}` : "";
  console.log(`\nNothing was sent. Check the address carefully, then run:\n  node scripts/send.js ${asset} ${amount} ${to}${extra} --yes\n`);
  process.exit(0);
}

const account = await horizon.loadAccount(kp.publicKey());
const builder = new TransactionBuilder(account, { fee: "10000", networkPassphrase: config.passphrase })
  .addOperation(op)
  .setTimeout(60);
if (memo) builder.addMemo(/^\d+$/.test(memo) && memo.length < 20 ? Memo.id(memo) : Memo.text(memo));
const tx = builder.build();
tx.sign(kp);

try {
  const res = await horizon.submitTransaction(tx);
  const after = await balances(kp.publicKey());
  console.log(`\nSent ✅  ${txLink(res.hash)}`);
  console.log(`Recipient: ${accountLink(to)}`);
  console.log(`Treasury balance now: ${after.xlm} XLM, ${after.usdc} USDC\n`);
} catch (err) {
  const codes = err?.response?.data?.extras?.result_codes;
  stop(`Send failed: ${codes ? JSON.stringify(codes) : err.message}\nNo money moved.`);
}
