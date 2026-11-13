export interface CrossingPoint {
  x: number;
  y: number;
}

export interface CrossingSegment {
  id: string;
  a: CrossingPoint;
  b: CrossingPoint;
}

export interface CrossingPair {
  a: string;
  b: string;
  x: number;
  y: number;
}

const orientation = (a: CrossingPoint, b: CrossingPoint, c: CrossingPoint): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const intersection = (
  a: CrossingPoint,
  b: CrossingPoint,
  c: CrossingPoint,
  d: CrossingPoint,
): CrossingPoint | undefined => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (
    !(((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
      ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0)))
  ) {
    return undefined;
  }
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return undefined;
  const determinantA = a.x * b.y - a.y * b.x;
  const determinantB = c.x * d.y - c.y * d.x;
  const x =
    (determinantA * (c.x - d.x) - (a.x - b.x) * determinantB) / denominator;
  const y =
    (determinantA * (c.y - d.y) - (a.y - b.y) * determinantB) / denominator;
  return { x, y };
};

const nearEndpoint = (point: CrossingPoint, segment: CrossingSegment): boolean => {
  const distance = (other: CrossingPoint) =>
    Math.hypot(point.x - other.x, point.y - other.y);
  return distance(segment.a) < 2 || distance(segment.b) < 2;
};

export const detectCrossingPairs = (
  segments: CrossingSegment[],
): CrossingPair[] => {
  const crossings: CrossingPair[] = [];
  for (let left = 0; left < segments.length; left += 1) {
    for (let right = left + 1; right < segments.length; right += 1) {
      const a = segments[left];
      const b = segments[right];
      const point = intersection(a.a, a.b, b.a, b.b);
      if (!point || nearEndpoint(point, a) || nearEndpoint(point, b)) continue;
      crossings.push({ a: a.id, b: b.id, x: point.x, y: point.y });
    }
  }
  return crossings;
};
