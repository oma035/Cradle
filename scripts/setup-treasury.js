// Creates or checks the Cradle treasury (escrow) wallet.
//   npm run setup:treasury            -> generate a new keypair (if TREASURY_SECRET is empty) or check the existing one
//   npm run setup:treasury -- --trust -> add the USDC trustline once the account holds XLM
import { Keypair } from "@stellar/stellar-sdk";
import { config, accountLink } from "../src/config.js";
import { addTrustline, balances } from "../src/stellar.js";

const wantsTrust = process.argv.includes("--trust");

if (!config.treasurySecret) {
  const kp = Keypair.random();
  console.log(`\nNew Cradle treasury wallet (${config.networkName})\n`);
  console.log(`  Public address: ${kp.publicKey()}`);
  console.log(`  Secret key:     ${kp.secret()}\n`);
  console.log("1. Put the secret key in .env as TREASURY_SECRET (never share it or commit it).");
  if (config.isMainnet) {
    console.log("2. Send at least 10 XLM to the public address (covers fees and sponsoring ~6 mother wallets;");
    console.log("   each new wallet locks ~1.5 XLM).");
    console.log("3. Run: npm run setup:treasury -- --trust   to add the USDC trustline.");
  } else {
    console.log("2. Fund it with test XLM: https://friendbot.stellar.org/?addr=" + kp.publicKey());
    console.log("3. Run: npm run setup:treasury -- --trust   to add the USDC trustline.");
    console.log("4. Get test USDC from https://faucet.circle.com (choose Stellar testnet).");
  }
  process.exit(0);
}

const kp = Keypair.fromSecret(config.treasurySecret);
let b = await balances(kp.publicKey());
console.log(`\nTreasury ${kp.publicKey()} on ${config.networkName}`);
console.log(`  ${accountLink(kp.publicKey())}`);

if (!b.exists) {
  console.log("\n  Account not found on the network yet. Fund it with XLM first.");
  process.exit(1);
}
if (!b.hasTrustline && wantsTrust) {
  const hash = await addTrustline(kp);
  console.log(`\n  USDC trustline added: ${hash}`);
  b = await balances(kp.publicKey());
}
console.log(`\n  XLM:  ${b.xlm}`);
console.log(`  USDC: ${b.hasTrustline ? b.usdc : "(no trustline yet: run with --trust)"}`);
