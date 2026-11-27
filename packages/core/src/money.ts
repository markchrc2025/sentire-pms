/**
 * Money helpers. All amounts are integer centavos (bigint). Never use floating point for money.
 */

export type Centavos = bigint;

export const VAT_RATE_PERCENT = 12n;

/** Round a rational number numerator/denominator half-up (away from zero for .5), returning bigint. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** VAT contained in a VAT-inclusive amount: round(amount * 12 / 112). */
export function vatFromInclusive(amount: Centavos, ratePercent: bigint = VAT_RATE_PERCENT): Centavos {
  return divRoundHalfUp(amount * ratePercent, 100n + ratePercent);
}

/** VATable (net) part of a VAT-inclusive amount. Net + VAT always equals the amount. */
export function netFromInclusive(amount: Centavos, ratePercent: bigint = VAT_RATE_PERCENT): Centavos {
  return amount - vatFromInclusive(amount, ratePercent);
}

/** Apply a percentage (e.g. 20 for 20%) to an amount, rounded half-up to the centavo. */
export function percentOf(amount: Centavos, percent: bigint): Centavos {
  return divRoundHalfUp(amount * percent, 100n);
}

/** Parse a peso string such as "1,234.50" or "1234.5" into centavos. Rejects more than two decimals. */
export function parsePeso(input: string): Centavos {
  const s = input.trim().replace(/[,₱\s]/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Invalid peso amount: ${input}`);
  const [, sign, whole, frac = ""] = m;
  const value = BigInt(whole!) * 100n + BigInt(frac.padEnd(2, "0"));
  return sign ? -value : value;
}

/** Format centavos as a peso amount: "₱1,234.50". */
export function formatPeso(amount: Centavos, opts: { sign?: boolean } = {}): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  const symbol = opts.sign === false ? "" : "₱";
  return `${negative ? "-" : ""}${symbol}${whole}.${frac}`;
}
