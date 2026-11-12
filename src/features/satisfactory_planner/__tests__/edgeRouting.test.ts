import { describe, expect, it } from 'vitest';
import { respaceColumns, type GraphEdge, type LayoutResult } from '../components/lineGraphLayout';
import { LANE_END_PADDING, LANE_PITCH, routeEdges } from '../components/edgeRouting';
import type {
  SupplyLineModel as DomainSupplyLineModel,
  SupplySourceNode as DomainSupplySourceNode,
  SupplyTransformerNode as DomainSupplyTransformerNode,
} from '../domain/types';

const source = (id: string, x: number, y: number): DomainSupplySourceNode => ({
  id,
  type: 'source',
  displayName: id,
  position: { x, y, z: 0 },
  clock: 1,
  boost: 0,
  shards: 0,
  expectedPower: 0,
  actualPower: 0,
  outputs: [{ id: `${id}:out`, itemId: 'Iron', expectedRate: 30, actualRate: 30 }],
});

const sink = (id: string, x: number, y: number): DomainSupplyTransformerNode => ({
  id,
  type: 'transformer',
  kind: 'machine',
  displayName: id,
  position: { x, y, z: 0 },
  inputs: [{ id: `${id}:in`, itemId: 'Iron', expectedRate: 30, actualRate: 30 }],
  outputs: [],
  clock: 1,
  boost: 0,
  shards: 0,
  expectedPower: 0,
  actualPower: 0,
  expectedPowerGeneration: 0,
  actualPowerGeneration: 0,
});

const edge = (id: string, from: string, to: string): GraphEdge => ({
  id,
  from,
  to,
  itemId: 'Iron',
  actualRate: 30,
  unknown: false,
  atCapacity: false,
  transportNodeIds: [],
  transportCount: 0,
});

const line: DomainSupplyLineModel = {
  id: 'line-1',
  name: 'Line',
  roots: [],
  nodes: {
    L1: source('L1', 0, 0),
    L2: source('L2', 0, 300),
    R1: sink('R1', 400, 0),
    R2: sink('R2', 400, 300),
  },
  summary: {
    inputs: [],
    outputs: [],
    power: {
      expectedConsumption: 0,
      actualConsumption: 0,
      expectedGeneration: 0,
      actualGeneration: 0,
    },
    bottlenecks: [],
  },
  notes: [],
  buildingIds: ['L1', 'L2', 'R1', 'R2'],
  transportNodeIds: [],
};

const positions = new Map([
  ['L1', { x: 0, y: 0 }],
  ['L2', { x: 0, y: 300 }],
  ['R1', { x: 400, y: 0 }],
  ['R2', { x: 400, y: 300 }],
]);
const heights = new Map([
  ['L1', 40],
  ['L2', 40],
  ['R1', 40],
  ['R2', 40],
]);
const unitOf = new Map([
  ['L1', 'unit:L1'],
  ['L2', 'unit:L2'],
  ['R1', 'unit:R1'],
  ['R2', 'unit:R2'],
]);
const unitBounds = new Map([
  ['unit:L1', { x: 0, y: 0, width: 220, height: 40 }],
  ['unit:L2', { x: 0, y: 300, width: 220, height: 40 }],
  ['unit:R1', { x: 400, y: 0, width: 220, height: 40 }],
  ['unit:R2', { x: 400, y: 300, width: 220, height: 40 }],
]);

describe('edge lane routing', () => {
  it('gives overlapping spans distinct lanes and reuses lanes for disjoint spans', () => {
    const result = routeEdges(
      line,
      [edge('e1', 'L1', 'R1'), edge('e2', 'L2', 'R2'), edge('e3', 'L1', 'R2')],
      positions,
      heights,
      new Map(),
      unitOf,
      unitBounds,
    );
    const e1 = result.routes.get('e1')!;
    const e2 = result.routes.get('e2')!;
    const e3 = result.routes.get('e3')!;
    expect(e1.laneIndex).toBe(0);
    expect(e2.laneIndex).toBe(0);
    expect(e1.centerX).toBe(e2.centerX);
    expect(e3.laneIndex).toBe(1);
    expect(e3.centerX).not.toBe(e1.centerX);
    expect(result.demands[0].requiredGap).toBe(
      2 * LANE_END_PADDING + 2 * LANE_PITCH,
    );
  });

  it('moves only the right-hand columns by the required extra gap', () => {
    const layout: LayoutResult = {
      visibleIds: ['A', 'B', 'C'],
      hiddenCount: 0,
      problemIds: new Set(),
      edges: [],
      positions: new Map([
        ['A', { x: 0, y: 0 }],
        ['B', { x: 400, y: 0 }],
        ['C', { x: 700, y: 0 }],
      ]),
      heights: new Map(),
      attachments: [],
      stackOf: new Map(),
      unitOf: new Map([
        ['A', 'unit:A'],
        ['B', 'unit:B'],
        ['C', 'unit:C'],
      ]),
      unitBounds: new Map([
        ['unit:A', { x: 0, y: 0, width: 220, height: 40 }],
        ['unit:B', { x: 400, y: 0, width: 220, height: 40 }],
        ['unit:C', { x: 700, y: 0, width: 220, height: 40 }],
      ]),
    };
    const result = respaceColumns(layout, [
      { leftUnitId: 'unit:A', rightUnitId: 'unit:B', requiredGap: 240 },
      { leftUnitId: 'unit:B', rightUnitId: 'unit:C', requiredGap: 120 },
    ]);
    expect(result.shifted).toBe(true);
    expect(result.positions.get('A')?.x).toBe(0);
    expect(result.positions.get('B')?.x).toBe(460);
    expect(result.positions.get('C')?.x).toBe(800);
    expect(result.unitShifts.get('unit:B')).toBe(60);
    expect(result.unitShifts.get('unit:C')).toBe(100);
  });
});
