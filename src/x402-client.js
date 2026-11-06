// Pays an x402 request on behalf of a mother, signing with her (decrypted) wallet key.
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { createEd25519Signer } from "@x402/stellar";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { config } from "./config.js";

export async function payForReview(secretKey, url, body) {
  const signer = createEd25519Signer(secretKey, config.x402Network);
  const rpcConfig = config.rpcUrl ? { url: config.rpcUrl } : undefined;
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: config.x402Network, client: new ExactStellarScheme(signer, rpcConfig) }],
  });

  const res = await fetchWithPayment(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Payment request failed with HTTP ${res.status}`);

  const settlement = decodeSettlement(res.headers);
  return { body: json, txHash: settlement?.transaction || null, payer: settlement?.payer || null };
}

/** Reads the x402 settlement receipt header (v2 name first, v1 fallback). */
export function decodeSettlement(headers) {
  const raw = headers.get("payment-response") || headers.get("x-payment-response");
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
