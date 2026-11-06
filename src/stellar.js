// Classic Stellar operations: sponsored wallet creation, USDC transfers, balances.
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { config } from "./config.js";

export const horizon = new Horizon.Server(config.horizonUrl);
export const USDC = new Asset("USDC", config.usdcIssuer);
const FEE = "10000"; // 0.001 XLM max fee per operation; generous enough to land during surges

export const treasury = () => Keypair.fromSecret(config.treasurySecret);
export const isValidAddress = (a) => StrKey.isValidEd25519PublicKey(String(a || "").trim());

async function submit(tx) {
  try {
    const res = await horizon.submitTransaction(tx);
    return res.hash;
  } catch (err) {
    const codes = err?.response?.data?.extras?.result_codes;
    throw new Error(`Stellar transaction failed: ${codes ? JSON.stringify(codes) : err.message}`);
  }
}

/**
 * Creates a new wallet for a mother. The Cradle treasury sponsors the account
 * reserve and the USDC trustline (~1.5 XLM locked, recoverable), so she needs no XLM.
 */
export async function createSponsoredWallet() {
  const sponsor = treasury();
  const user = Keypair.random();
  const account = await horizon.loadAccount(sponsor.publicKey());

  const tx = new TransactionBuilder(account, { fee: FEE, networkPassphrase: config.passphrase })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: user.publicKey() }))
    .addOperation(Operation.createAccount({ destination: user.publicKey(), startingBalance: "0" }))
    .addOperation(Operation.changeTrust({ asset: USDC, source: user.publicKey() }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: user.publicKey() }))
    .setTimeout(120)
    .build();
  tx.sign(sponsor, user);
  const hash = await submit(tx);
  return { publicKey: user.publicKey(), secret: user.secret(), txHash: hash };
}

/** Sends USDC from `fromKeypair` to `to`. Returns the transaction hash. */
export async function sendUsdc(fromKeypair, to, amount, memoText) {
  const account = await horizon.loadAccount(fromKeypair.publicKey());
  const builder = new TransactionBuilder(account, { fee: FEE, networkPassphrase: config.passphrase })
    .addOperation(Operation.payment({ destination: to, asset: USDC, amount: String(amount) }))
    .setTimeout(120);
  if (memoText) builder.addMemo(Memo.text(String(memoText).slice(0, 28)));
  const tx = builder.build();
  tx.sign(fromKeypair);
  return submit(tx);
}

/** Returns { usdc, xlm, hasTrustline, exists } for an address. */
export async function balances(address) {
  try {
    const acc = await horizon.loadAccount(address);
    const usdcLine = acc.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === config.usdcIssuer
    );
    const xlm = acc.balances.find((b) => b.asset_type === "native");
    return {
      exists: true,
      hasTrustline: Boolean(usdcLine),
      usdc: usdcLine ? usdcLine.balance : "0",
      xlm: xlm ? xlm.balance : "0",
    };
  } catch (err) {
    if (err?.response?.status === 404) return { exists: false, hasTrustline: false, usdc: "0", xlm: "0" };
    throw err;
  }
}

/** Adds a USDC trustline to an existing, XLM-funded account (used for the treasury). */
export async function addTrustline(keypair) {
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: FEE, networkPassphrase: config.passphrase })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(120)
    .build();
  tx.sign(keypair);
  return submit(tx);
}
