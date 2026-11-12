export const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const perMinute = (amount: number, durationSeconds: number): number =>
  durationSeconds > 0 ? (amount / durationSeconds) * 60 : 0;

export const inputMultiplier = (clock: number): number => Math.max(0.01, clock);

export const productionBoostMultiplier = (boost: number): number =>
  boost > 0 ? Math.max(1, boost) : 1;

export const effectiveMultiplier = (clock: number, boost: number): number =>
  inputMultiplier(clock) * productionBoostMultiplier(boost);

export const estimatedPower = (
  basePower: number,
  clock: number,
  powerExponent: number,
  boost = 0,
  boostPowerExponent = 2,
): number =>
  basePower *
  Math.max(0.01, clock) ** powerExponent *
  productionBoostMultiplier(boost) ** boostPowerExponent;

export const extractorRate = (baseRate: number, purity: number, clock: number): number =>
  baseRate * purity * Math.max(0.01, clock);

export const sumRate = (rates: { rate: number }[]): number =>
  rates.reduce((total, entry) => total + entry.rate, 0);

export const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : part / whole;

export interface CappedAllocation {
  rates: number[];
  delivered: number;
  limited: boolean;
}

const ALLOCATION_EPSILON = 1e-9;

export const allocateCappedOutputs = (
  input: number,
  caps: (number | undefined)[],
): CappedAllocation => {
  const rates = caps.map(() => 0);
  if (caps.length === 0 || input <= 0) {
    return { rates, delivered: 0, limited: false };
  }

  let remaining = input;
  let active = caps.map((_, index) => index);
  while (remaining > ALLOCATION_EPSILON && active.length > 0) {
    const share = remaining / active.length;
    for (const index of active) {
      const cap = caps[index];
      const room = cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap) - rates[index];
      const added = Math.min(share, room);
      rates[index] += added;
      remaining -= added;
    }
    active = active.filter((index) => {
      const cap = caps[index];
      return cap === undefined || rates[index] + ALLOCATION_EPSILON < cap;
    });
  }

  const delivered = rates.reduce((sum, rate) => sum + rate, 0);
  return { rates, delivered, limited: delivered + 1e-6 < input };
};
