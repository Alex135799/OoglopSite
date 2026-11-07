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
import type { SplitterNode } from '../domain/types';
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

const layout = (buildings: ReturnType<typeof building>[], transportNodes: SplitterNode[]) => {
  const rawLine = line('line-1', buildings.map((entry) => entry.id), {
    name: 'Line',
    flows: [],
  });
  const m = model({ buildings, lines: [rawLine] });
  const supply = buildSupplyLineModel(m, rawLine, gameData, {
    transportNodes,
    transportRuns: [],
  });
  return layoutSupplyGraph(supply, [], false, 150);
};

describe('machine-attached control layout', () => {
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
    expect(s1.y).toBeCloseTo(s2.y);
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
    expect(s1.y).toBeCloseTo(c1.y + (NODE_HEIGHT - CONTROL_SIZE) / 2);
    expect(result.attachments.find((entry) => entry.controlId === 'S1')?.machineId).toBe('C1');
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
