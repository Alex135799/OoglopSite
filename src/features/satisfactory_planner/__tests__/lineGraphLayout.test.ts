import { describe, expect, it } from 'vitest';
import { gameData } from '../api/gameData';
import { buildSupplyLineModel } from '../domain/buildSupplyLineModel';
import {
  CONTROL_GAP,
  CONTROL_SIZE,
  COLUMN_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  SLOT_PITCH,
  layoutSupplyGraph,
} from '../components/lineGraphLayout';
import type { ProductionLine, SplitterNode, TransportRun } from '../domain/types';
import { building, line, model, rates } from './helpers';

const source = (id: string, item: string) =>
  building(id, { outputs: rates({ [item]: 60 }) });

const machine = (id: string, inputs: Record<string, number>, recipeId = `Recipe_${id}`) =>
  building(id, {
    displayName: `Machine ${id}`,
    recipeId,
    inputs: rates(inputs),
    outputs: rates({ Product: 30 }),
  });

const control = (
  id: string,
  inputs: string[],
  outputs: string[],
  itemId: string,
) : SplitterNode => ({
  id,
  typeId: 'Build_ConveyorAttachmentSplitter_C',
  kind: 'splitter',
  itemId,
  inputs,
  outputs,
  directInputs: inputs,
  directOutputs: outputs,
  inputRoles: inputs.map((input) => ({
    id: input,
    role: 'sink' as const,
  })),
  outputRoles: outputs.map((output) => ({
    id: output,
    role: 'tap' as const,
  })),
});

const layout = (
  buildings: ReturnType<typeof building>[],
  transportNodes: SplitterNode[],
  transportRuns: TransportRun[] = [],
  flows: ProductionLine['flows'] = [],
  problemsOnly = false,
) => {
  const rawLine = line('line-1', buildings.map((entry) => entry.id), {
    name: 'Line',
    flows,
  });
  const m = model({ buildings, lines: [rawLine] });
  const supply = buildSupplyLineModel(m, rawLine, gameData, {
    transportNodes,
    transportRuns,
  });
  return layoutSupplyGraph(supply, [], problemsOnly, 150);
};

describe('machine-attached control layout', () => {
  it('keeps every fan-out edge from a source port', () => {
    const buildings = [
      source('A', 'One'),
      machine('B', { One: 30 }),
      machine('C', { One: 30 }),
    ];
    const result = layout(buildings, [], [], [
      { from: 'A', to: 'B', itemId: 'One', rate: 30 },
      { from: 'A', to: 'C', itemId: 'One', rate: 30 },
    ]);
    expect(result.edges.map((edge) => edge.to).sort()).toEqual(['B', 'C']);
  });

  it('keeps a bottleneck splitter in the problems-only view', () => {
    const buildings = [
      source('A', 'Desc_OreIron_C'),
      machine('B', { Desc_OreIron_C: 60 }),
      machine('C', { Desc_OreIron_C: 60 }),
    ];
    const splitter: SplitterNode = {
      ...control('S1', ['A'], ['B', 'C'], 'Desc_OreIron_C'),
      directOutputs: [],
      outputRoles: [],
    };
    const runs: TransportRun[] = [
      {
        id: 'run-B',
        medium: 'belt',
        typeId: 'Build_ConveyorBeltMk1_C',
        fromNodeId: 'S1',
        toNodeId: 'B',
        itemId: 'Desc_OreIron_C',
        capacity: 20,
        segmentCount: 1,
        segmentIds: ['belt-B'],
      },
      {
        id: 'run-C',
        medium: 'belt',
        typeId: 'Build_ConveyorBeltMk1_C',
        fromNodeId: 'S1',
        toNodeId: 'C',
        itemId: 'Desc_OreIron_C',
        capacity: 30,
        segmentCount: 1,
        segmentIds: ['belt-C'],
      },
    ];
    const result = layout(buildings, [splitter], runs, [], true);
    expect(result.problemIds.has('S1')).toBe(true);
    expect(result.visibleIds).toContain('S1');
  });

  it('keeps collapsed belt capacity metadata on the drawn edge', () => {
    const buildings = [
      source('A', 'Desc_OreIron_C'),
      machine('B', { Desc_OreIron_C: 60 }),
    ];
    const run: TransportRun = {
      id: 'run-1',
      medium: 'belt',
      typeId: 'Build_ConveyorBeltMk1_C',
      fromNodeId: 'A',
      toNodeId: 'B',
      itemId: 'Desc_OreIron_C',
      capacity: 30,
      segmentCount: 2,
      segmentIds: ['belt-1', 'belt-2'],
    };
    const result = layout(buildings, [], [run]);
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      from: 'A',
      to: 'B',
      transportNodeIds: ['run-1'],
      transportCount: 1,
      beltCapacity: 30,
      beltActualRate: 30,
    });
  });

  it('places input controls in recipe order in progressively farther columns', () => {
    const buildings = [source('A', 'One'), source('B', 'Two'), machine('C', { One: 30, Two: 30 })];
    const result = layout(buildings, [
      control('S1', ['A'], ['C'], 'One'),
      control('S2', ['B'], ['C'], 'Two'),
    ]);
    const c = result.positions.get('C')!;
    const s1 = result.positions.get('S1')!;
    const s2 = result.positions.get('S2')!;
    expect(s1.x).toBeLessThan(c.x);
    expect(s2.x).toBeLessThan(s1.x);
    expect(s1.x).toBeCloseTo(c.x - CONTROL_GAP - CONTROL_SIZE);
    expect(s2.x).toBeCloseTo(c.x - CONTROL_GAP - CONTROL_SIZE - (CONTROL_SIZE + COLUMN_GAP));
    const h = result.heights.get('C')!;
    expect(s1.y + CONTROL_SIZE / 2).toBeCloseTo(c.y + h / 3);
    expect(s2.y + CONTROL_SIZE / 2).toBeCloseTo(c.y + (h * 2) / 3);
  });

  it('uses vertical slots and expands row height for same-port controls', () => {
    const buildings = [source('A', 'One'), machine('C', { One: 60 })];
    const result = layout(buildings, [
      control('S1', ['A'], ['C'], 'One'),
      control('S2', ['A'], ['C'], 'One'),
    ]);
    const s1 = result.positions.get('S1')!;
    const s2 = result.positions.get('S2')!;
    expect(s1.x).toBeCloseTo(s2.x);
    expect(Math.abs(s1.y - s2.y)).toBeCloseTo(SLOT_PITCH);
    expect(result.heights.get('C')).toBeGreaterThan(NODE_HEIGHT);
    expect(result.attachments.find((entry) => entry.controlId === 'S1')?.slotCount).toBe(2);
  });

  it('anchors a splitter beside the first machine it feeds', () => {
    const buildings = [
      source('A', 'One'),
      machine('C1', { One: 30 }, 'Recipe_Shared'),
      machine('C2', { One: 30 }, 'Recipe_Shared'),
    ];
    const result = layout(buildings, [control('S1', ['A'], ['C1', 'C2'], 'One')]);
    const c1 = result.positions.get('C1')!;
    const c2 = result.positions.get('C2')!;
    const s1 = result.positions.get('S1')!;
    expect(s1.x).toBeLessThan(c1.x);
    const h1 = result.heights.get('C1')!;
    const h2 = result.heights.get('C2')!;
    expect(s1.y).toBeCloseTo(
      (c1.y + h1 / 2 + c2.y + h2 / 2) / 2 - CONTROL_SIZE / 2,
    );
    expect(result.attachments.find((entry) => entry.controlId === 'S1')?.machineId).toBe('C1');
  });

  it('aligns a merger with the selected output point of a multi-output machine', () => {
    const buildings = [
      building('B', {
        displayName: 'Multi output',
        outputs: rates({ One: 30, Two: 30 }),
      }),
      machine('D', { Two: 30 }),
    ];
    const merger = {
      ...control('M1', ['B'], ['D'], 'Two'),
      kind: 'merger' as const,
      typeId: 'Build_ConveyorAttachmentMerger_C',
      inputRoles: [{ id: 'B', role: 'sink' as const }],
      outputRoles: [{ id: 'D', role: 'tap' as const }],
    };
    const result = layout(buildings, [merger]);
    const b = result.positions.get('B')!;
    const m1 = result.positions.get('M1')!;
    const h = result.heights.get('B')!;
    expect(m1.x).toBeGreaterThan(b.x + NODE_WIDTH);
    expect(m1.y + CONTROL_SIZE / 2).toBeCloseTo(b.y + (h * 2) / 3);
  });

  it('places mergers to the right of their source machines', () => {
    const buildings = [
      machine('C1', { One: 30 }, 'Recipe_Shared'),
      machine('C2', { One: 30 }, 'Recipe_Shared'),
      machine('D', { One: 60 }),
    ];
    const merger = {
      ...control('M1', ['C1', 'C2'], ['D'], 'One'),
      kind: 'merger' as const,
      typeId: 'Build_ConveyorAttachmentMerger_C',
      inputRoles: [
        { id: 'C1', role: 'sink' as const },
        { id: 'C2', role: 'sink' as const },
      ],
      outputRoles: [{ id: 'D', role: 'tap' as const }],
    };
    const result = layout(buildings, [merger]);
    const c1 = result.positions.get('C1')!;
    const c2 = result.positions.get('C2')!;
    const m1 = result.positions.get('M1')!;
    expect(m1.x).toBeGreaterThan(c1.x + NODE_WIDTH);
    expect(m1.x).toBeGreaterThan(c2.x + NODE_WIDTH);
    expect(result.attachments.find((entry) => entry.controlId === 'M1')?.side).toBe('right');
  });

  it('groups machines with the same recipe into one column without merging nodes', () => {
    const buildings = [
      source('A', 'One'),
      machine('C1', { One: 30 }, 'Recipe_Shared'),
      machine('C2', { One: 30 }, 'Recipe_Shared'),
    ];
    const result = layout(buildings, []);
    expect(result.stackOf.get('C1')).toBe(result.stackOf.get('C2'));
    const c1 = result.positions.get('C1')!;
    const c2 = result.positions.get('C2')!;
    expect(c1.x).toBeCloseTo(c2.x);
    expect(c1.y).not.toBeCloseTo(c2.y);
    expect(result.visibleIds).toContain('C1');
    expect(result.visibleIds).toContain('C2');
  });
});
