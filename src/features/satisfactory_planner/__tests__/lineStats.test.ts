import { describe, expect, it } from 'vitest';
import { getLineStats } from '../domain/lineStats';
import { building, line, model } from './helpers';

describe('getLineStats', () => {
  it('excludes single-building lines and counts modeled buildings', () => {
    const stats = getLineStats(
      model({
        buildings: [building('A'), building('B'), building('C')],
        lines: [
          line('line-1', ['A', 'B'], {
            flows: [{ from: 'A', to: 'B', itemId: 'Plate', rate: 10 }],
          }),
          line('line-2', ['C']),
        ],
      }),
    );
    expect(stats.activeLines.map((line) => line.id)).toEqual(['line-1']);
    expect(stats.buildingsInLines).toBe(2);
    expect(stats.totalModeled).toBe(3);
    expect(stats.totalCandidates).toBe(3);
    expect(stats.ratio).toBeCloseTo(2 / 3);
    expect(stats.flows).toBe(1);
  });

  it('returns zero when there are no active lines or modeled buildings', () => {
    const stats = getLineStats(model({ buildings: [], lines: [] }));
    expect(stats).toMatchObject({
      activeLines: [],
      buildingsInLines: 0,
      totalModeled: 0,
      totalCandidates: 0,
      flows: 0,
      ratio: 0,
    });
  });

  it('keeps unknown-only connected lines but does not count modeled buildings', () => {
    const stats = getLineStats(
      model({
        buildings: [
          building('U1', { modeled: false }),
          building('U2', { modeled: false }),
        ],
        lines: [line('line-1', ['U1', 'U2'])],
      }),
    );
    expect(stats.activeLines).toHaveLength(1);
    expect(stats.buildingsInLines).toBe(0);
    expect(stats.totalModeled).toBe(0);
    expect(stats.totalCandidates).toBe(2);
  });

  it('counts known but rate-unknown buildings when they are in a line', () => {
    const stats = getLineStats(
      model({
        buildings: [
          building('A', { modeled: false, knownType: true }),
          building('B', { modeled: false, knownType: true }),
        ],
        lines: [line('line-1', ['A', 'B'])],
      }),
    );
    expect(stats.buildingsInLines).toBe(2);
    expect(stats.totalCandidates).toBe(2);
    expect(stats.ratio).toBe(1);
  });
});
