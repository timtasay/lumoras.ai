/**
 * Money is integer micro-US-dollars ("micros", µUSD) everywhere: in the
 * database (bigint), in the ledger, in estimates and in budgets.
 *   1 USD = 1,000,000 micros;  DataForSEO's $0.000036 per backlink row = 36 micros.
 * Floats exist only at the edge: a provider's "cost": 0.0132 is converted once,
 * here, and a budget typed as "25.00" is converted once, here.
 */
export const MICROS_PER_USD = 1_000_000;

/** Provider-reported USD → micros (round to the nearest micro; providers bill in fractions of a cent). */
export function usdToMicros(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) throw new RangeError(`not a cost: ${usd}`);
  return Math.round(usd * MICROS_PER_USD);
}

/** "25", "25.5", "$0.0121" → micros. Null when it is not a non-negative amount with at most 6 decimals. */
export function parseUsd(input: string): number | null {
  const m = /^\s*\$?\s*(\d{1,9})(?:\.(\d{1,6}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * MICROS_PER_USD + Number((m[2] ?? "").padEnd(6, "0"));
}

/**
 * Human money: whole cents when the amount is at least ten cents, four
 * decimals below that so a $0.0121 lookup does not read as "$0.01".
 */
export function formatMicros(micros: number, opts: { exact?: boolean } = {}): string {
  const sign = micros < 0 ? "−" : "";
  const abs = Math.abs(micros);
  const usd = abs / MICROS_PER_USD;
  if (opts.exact) return `${sign}$${usd.toFixed(6).replace(/0{1,4}$/, "")}`;
  if (abs === 0) return "$0.00";
  if (abs < 100_000) return `${sign}$${usd.toFixed(4)}`;
  return `${sign}$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Plain decimal string for forms and CSV ("25.000000" → "25", "0.0121"). */
export function microsToDecimal(micros: number): string {
  const whole = Math.trunc(micros / MICROS_PER_USD);
  const frac = String(Math.abs(micros % MICROS_PER_USD)).padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}
