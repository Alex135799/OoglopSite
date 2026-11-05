export const round = (value: number, digits = 4): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export const perMinute = (amount: number, durationSeconds: number): number =>
  durationSeconds > 0 ? (amount / durationSeconds) * 60 : 0;

export const effectiveMultiplier = (clock: number, boost: number): number =>
  Math.max(0.01, clock) * (1 + Math.max(0, boost));

export const estimatedPower = (
  basePower: number,
  clock: number,
  powerExponent: number,
  boost = 0,
  boostPowerExponent = 2,
): number =>
  basePower *
  Math.max(0.01, clock) ** powerExponent *
  (1 + Math.max(0, boost)) ** boostPowerExponent;

export const extractorRate = (baseRate: number, purity: number, clock: number): number =>
  baseRate * purity * Math.max(0.01, clock);

export const sumRate = (rates: { rate: number }[]): number =>
  rates.reduce((total, entry) => total + entry.rate, 0);

export const percent = (part: number, whole: number): number =>
  whole === 0 ? 0 : part / whole;
