// Exact USDC math in stroops (7 decimals) to avoid floating-point errors.
export const DECIMALS = 7n;
const SCALE = 10n ** DECIMALS;

export function toStroops(amount) {
  const s = String(amount).replace(/^\$/, "").trim();
  if (!/^\d+(\.\d{1,7})?$/.test(s)) throw new Error(`Invalid amount: ${amount}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(7, "0"));
}

export function fromStroops(stroops) {
  const n = BigInt(stroops);
  const whole = n / SCALE;
  const frac = (n % SCALE).toString().padStart(7, "0");
  return `${whole}.${frac}`;
}

/** Expert's share of a price, rounded down to the stroop. */
export function shareOf(amount, percent) {
  const p = BigInt(Math.round(Number(percent) * 100)); // basis points
  return fromStroops((toStroops(amount) * p) / 10000n);
}

export function pretty(amount) {
  return `$${Number(amount).toFixed(2)}`;
}
