import { describe, expect, it } from 'vitest';
import {
  effectiveMultiplier,
  estimatedPower,
  extractorRate,
  perMinute,
  percent,
  round,
  sumRate,
} from '../domain/rateMath';

describe('rateMath', () => {
  it('converts recipe amounts to per-minute rates', () => {
    expect(perMinute(2, 6)).toBe(20);
    expect(perMinute(3, 0)).toBe(0);
  });

  it('combines clock and somersloop boost', () => {
    expect(effectiveMultiplier(1, 0)).toBe(1);
    expect(effectiveMultiplier(1.5, 0.5)).toBe(2.25);
    expect(effectiveMultiplier(-1, -2)).toBe(0.01);
  });

  it('estimates machine power with clock and boost exponents', () => {
    expect(estimatedPower(4, 1, 1.321929)).toBe(4);
    expect(estimatedPower(4, 2, 2)).toBe(16);
    expect(estimatedPower(4, 2, 2, 0.5, 2)).toBe(36);
  });

  it('applies extractor purity and clock', () => {
    expect(extractorRate(120, 2, 1)).toBe(240);
    expect(extractorRate(120, 0.5, 1.5)).toBe(90);
  });

  it('sums rates, computes percentages and rounds', () => {
    expect(sumRate([{ rate: 1 }, { rate: 2.5 }])).toBe(3.5);
    expect(percent(1, 4)).toBe(0.25);
    expect(percent(1, 0)).toBe(0);
    expect(round(1.23456, 2)).toBe(1.23);
  });
});
