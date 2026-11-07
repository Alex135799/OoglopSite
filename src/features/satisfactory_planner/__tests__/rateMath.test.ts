import { describe, expect, it } from 'vitest';
import {
  allocateCappedOutputs,
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

  it('splits output rates equally when no belt capacity binds', () => {
    expect(allocateCappedOutputs(60, [undefined, undefined])).toEqual({
      rates: [30, 30],
      delivered: 60,
      limited: false,
    });
  });

  it('redistributes output flow when one belt capacity binds', () => {
    const result = allocateCappedOutputs(60, [20, 60]);
    expect(result.rates).toEqual([20, 40]);
    expect(result.delivered).toBe(60);
    expect(result.limited).toBe(false);
  });

  it('reports a limited splitter when every output belt is saturated', () => {
    const result = allocateCappedOutputs(60, [20, 30]);
    expect(result.rates).toEqual([20, 30]);
    expect(result.delivered).toBe(50);
    expect(result.limited).toBe(true);
  });

  it('treats unresolved output capacity as unbounded', () => {
    expect(allocateCappedOutputs(100, [30, 30, undefined])).toEqual({
      rates: [30, 30, 40],
      delivered: 100,
      limited: false,
    });
  });

  it('handles zero input and no outputs', () => {
    expect(allocateCappedOutputs(0, [20, 30])).toEqual({
      rates: [0, 0],
      delivered: 0,
      limited: false,
    });
    expect(allocateCappedOutputs(60, [])).toEqual({
      rates: [],
      delivered: 0,
      limited: false,
    });
  });

  it('sums rates, computes percentages and rounds', () => {
    expect(sumRate([{ rate: 1 }, { rate: 2.5 }])).toBe(3.5);
    expect(percent(1, 4)).toBe(0.25);
    expect(percent(1, 0)).toBe(0);
    expect(round(1.23456, 2)).toBe(1.23);
  });
});
