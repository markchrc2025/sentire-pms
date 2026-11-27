import { divRoundHalfUp, type Centavos } from "./money";

/**
 * Deposit and cancellation policy maths (FR-09). Pure functions: the caller passes the stay's
 * nightly rates (VAT-inclusive centavos) and the times involved.
 */
export type ChargeKind = "NONE" | "FIRST_NIGHT" | "PERCENT" | "FULL_STAY";

export interface PolicyTerms {
  guarantee: ChargeKind;
  /** Basis points when guarantee is PERCENT (2500 = 25%). */
  guaranteeValue: bigint;
  /** Cancelling at least this many hours before arrival costs nothing. null: never free (non-refundable). */
  freeCancelHours: number | null;
  lateCancelPenalty: ChargeKind;
  lateCancelValue: bigint;
  noShowPenalty: ChargeKind;
  noShowValue: bigint;
}

/** Amount for a charge kind over a stay's nightly rates. PERCENT rounds half-up to the centavo. */
export function chargeAmount(kind: ChargeKind, valueBp: bigint, nightlyRates: Centavos[]): Centavos {
  const total = nightlyRates.reduce((a, b) => a + b, 0n);
  switch (kind) {
    case "NONE":
      return 0n;
    case "FIRST_NIGHT":
      return nightlyRates[0] ?? 0n;
    case "FULL_STAY":
      return total;
    case "PERCENT":
      return divRoundHalfUp(total * valueBp, 10_000n);
  }
}

/** Deposit needed to confirm (guarantee) the booking. */
export function guaranteeAmount(p: PolicyTerms, nightlyRates: Centavos[]): Centavos {
  return chargeAmount(p.guarantee, p.guaranteeValue, nightlyRates);
}

/** Last moment a guest can cancel for free, or null when the rate is non-refundable. */
export function freeCancelUntil(p: PolicyTerms, arrivalAt: Date): Date | null {
  if (p.freeCancelHours === null) return null;
  return new Date(arrivalAt.getTime() - p.freeCancelHours * 3_600_000);
}

/**
 * Penalty for cancelling at cancelAt. Free up to freeCancelHours before arrival (inclusive),
 * the late-cancellation penalty after that. Never more than the stay total.
 */
export function penaltyAt(p: PolicyTerms, opts: { arrivalAt: Date; cancelAt: Date; nightlyRates: Centavos[] }): Centavos {
  const until = freeCancelUntil(p, opts.arrivalAt);
  if (until && opts.cancelAt.getTime() <= until.getTime()) return 0n;
  const total = opts.nightlyRates.reduce((a, b) => a + b, 0n);
  const amt = chargeAmount(p.lateCancelPenalty, p.lateCancelValue, opts.nightlyRates);
  return amt > total ? total : amt;
}

/** Penalty when the guest does not arrive (charged by night audit). */
export function noShowPenaltyAmount(p: PolicyTerms, nightlyRates: Centavos[]): Centavos {
  return chargeAmount(p.noShowPenalty, p.noShowValue, nightlyRates);
}

/**
 * The instant a local date and time happens in a time zone, e.g. check-in at 14:00 Manila time.
 * Works for zones with daylight saving too (uses the zone's offset at that moment).
 */
export function zonedInstant(date: string, time: string, timeZone = "Asia/Manila"): Date {
  const [h = 0, m = 0, s = 0] = time.split(":").map(Number);
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m, s);
  const offset = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - at;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}
