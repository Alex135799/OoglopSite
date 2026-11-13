import { describe, expect, it } from 'vitest';
import { detectCrossingPairs } from '../components/tierCrossings';

describe('tier crossings', () => {
  it('detects a proper crossing between tier edges', () => {
    const crossings = detectCrossingPairs([
      { id: 'a', a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { id: 'b', a: { x: 0, y: 10 }, b: { x: 10, y: 0 } },
    ]);
    expect(crossings).toHaveLength(1);
  });

  it('does not count a shared endpoint as a crossing', () => {
    const crossings = detectCrossingPairs([
      { id: 'a', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { id: 'b', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
    ]);
    expect(crossings).toEqual([]);
  });
});
