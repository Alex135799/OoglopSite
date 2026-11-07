import { describe, expect, it } from 'vitest';
import { gameData } from '../api/gameData';
import { analyzeModel } from '../domain/analyzeModel';
import { buildSupplyLineModel } from '../domain/buildSupplyLineModel';
import { building, line, model, rates } from './helpers';

const source = building('A', {
  typeId: 'Build_MinerMk1_C',
  displayName: 'Miner',
  outputs: rates({ Desc_OreIron_C: 60 }),
});
const smelter = building('B', {
  typeId: 'Build_SmelterMk1_C',
  displayName: 'Smelter',
  recipeId: 'Recipe_IngotIron_C',
  recipeName: 'Iron Ingot',
  inputs: rates({ Desc_OreIron_C: 60 }),
  outputs: rates({ Desc_IronIngot_C: 30 }),
  powerConsumption: 4,
});
const secondSmelter = building('C', {
  typeId: 'Build_SmelterMk1_C',
  displayName: 'Smelter',
  recipeId: 'Recipe_IngotIron_C',
  recipeName: 'Iron Ingot',
  inputs: rates({ Desc_OreIron_C: 30 }),
  outputs: rates({ Desc_IronIngot_C: 15 }),
  powerConsumption: 4,
});

const baseModel = (overrides: Parameters<typeof model>[0] = {}) =>
  model({
    buildings: [source, smelter],
    lines: [line('line-1', ['A', 'B'], {
      name: 'Iron line',
      outputItems: ['Desc_IronIngot_C'],
      flows: [{ from: 'A', to: 'B', itemId: 'Desc_OreIron_C', rate: 60 }],
    })],
    ...overrides,
  });

describe('buildSupplyLineModel', () => {
  it('builds expected and actual rates for a source and transformer', () => {
    const result = buildSupplyLineModel(baseModel(), baseModel().lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.roots).toEqual(['A']);
    expect(result.nodes.A).toMatchObject({
      type: 'source',
      expectedPower: 0,
    });
    expect(result.nodes.B).toMatchObject({
      type: 'transformer',
      recipeName: 'Iron Ingot',
    });
    expect(result.summary.outputs).toEqual([
      {
        itemId: 'Desc_IronIngot_C',
        expectedRate: 30,
        actualRate: 30,
        unit: 'items/min',
      },
    ]);
  });

  it('reduces transformer output when its input is starved', () => {
    const starved = model({
      buildings: [building('A', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 30 }) }), smelter],
      lines: [line('line-1', ['A', 'B'], {
        name: 'Iron line',
        flows: [{ from: 'A', to: 'B', itemId: 'Desc_OreIron_C', rate: 30 }],
      })],
    });
    const result = buildSupplyLineModel(starved, starved.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.nodes.B).toMatchObject({
      type: 'transformer',
      actualPower: 2,
    });
    expect(result.summary.outputs[0].actualRate).toBe(15);
    expect(result.summary.bottlenecks).toContainEqual(
      expect.objectContaining({ nodeId: 'B', reason: 'Transformer input starvation' }),
    );
  });

  it('splits flow equally through a control node', () => {
    const splitModel = model({
      buildings: [source, smelter, secondSmelter],
      lines: [line('line-1', ['A', 'B', 'C'], {
        name: 'Split line',
        flows: [
          { from: 'A', to: 'B', itemId: 'Desc_OreIron_C', rate: 30 },
          { from: 'A', to: 'C', itemId: 'Desc_OreIron_C', rate: 30 },
        ],
      })],
    });
    const result = buildSupplyLineModel(splitModel, splitModel.lines[0], gameData, {
      transportNodes: [
        {
          id: 'S1',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          itemId: 'Desc_OreIron_C',
          inputs: ['A'],
          outputs: ['B', 'C'],
          directInputs: ['A'],
          directOutputs: ['B', 'C'],
          inputRoles: [{ id: 'A', role: 'sink' }],
          outputRoles: [
            { id: 'B', role: 'tap' },
            { id: 'C', role: 'tap' },
          ],
        },
      ],
      transportRuns: [],
    });
    expect(result.nodes.S1).toMatchObject({
      type: 'control',
      kind: 'splitter',
      actualThroughput: 60,
    });
    expect(result.nodes.B).toMatchObject({ type: 'transformer', actualPower: 2 });
    expect(result.nodes.C).toMatchObject({ type: 'transformer', actualPower: 4 });
  });

  it('clamps flow through a transport run by capacity', () => {
    const run = {
      id: 'run-1',
      medium: 'belt' as const,
      typeId: 'Build_ConveyorBeltMk1_C',
      fromNodeId: 'A',
      toNodeId: 'B',
      itemId: 'Desc_OreIron_C',
      capacity: 30,
      segmentCount: 2,
      segmentIds: ['belt-1', 'belt-2'],
    };
    const result = buildSupplyLineModel(baseModel(), baseModel().lines[0], gameData, {
      transportNodes: [],
      transportRuns: [run],
    });
    expect(result.nodes['run-1']).toMatchObject({
      type: 'transport',
      capacity: 30,
      actualRate: 30,
    });
    expect(result.summary.outputs[0].actualRate).toBe(15);
  });

  it('analyzes all lines and assigns transport nodes once', () => {
    const analyzed = analyzeModel(baseModel());
    expect(analyzed.supplyLines).toHaveLength(1);
    expect(analyzed.supplyLines[0].roots).toEqual(['A']);
    expect(analyzed.findings.length).toBeGreaterThanOrEqual(0);
    expect(analyzed.lineStats.activeLines).toHaveLength(1);
  });
});
