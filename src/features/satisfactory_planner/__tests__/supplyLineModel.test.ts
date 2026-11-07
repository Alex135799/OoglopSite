import { describe, expect, it } from 'vitest';
import { gameData } from '../api/gameData';
import { analyzeModel } from '../domain/analyzeModel';
import { buildSupplyLineModel } from '../domain/buildSupplyLineModel';
import type { TransportRun } from '../domain/types';
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

  const splitterWithRuns = (capacities: [number | undefined, number | undefined]) => {
    const runs: TransportRun[] = [
      {
        id: 'run-B',
        medium: 'belt',
        typeId: 'Build_ConveyorBeltMk1_C',
        fromNodeId: 'S1',
        toNodeId: 'B',
        itemId: 'Desc_OreIron_C',
        ...(capacities[0] !== undefined ? { capacity: capacities[0] } : {}),
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
        ...(capacities[1] !== undefined ? { capacity: capacities[1] } : {}),
        segmentCount: 1,
        segmentIds: ['belt-C'],
      },
    ];
    const splitModel = model({
      buildings: [source, smelter, secondSmelter],
      lines: [line('line-1', ['A', 'B', 'C'], { name: 'Split line', flows: [] })],
    });
    return buildSupplyLineModel(splitModel, splitModel.lines[0], gameData, {
      transportNodes: [
        {
          id: 'S1',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          itemId: 'Desc_OreIron_C',
          inputs: ['A'],
          outputs: ['B', 'C'],
          directInputs: ['A'],
          directOutputs: [],
          inputRoles: [{ id: 'A', role: 'sink' }],
          outputRoles: [],
        },
      ],
      transportRuns: runs,
    });
  };

  it('assigns transport runs between controls to the line', () => {
    const splitModel = model({
      buildings: [source, smelter],
      lines: [line('line-1', ['A', 'B'], { name: 'Split line', flows: [] })],
      transportNodes: [
        {
          id: 'S1',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          itemId: 'Desc_OreIron_C',
          inputs: ['A'],
          outputs: ['B'],
          directInputs: ['A'],
          directOutputs: ['S2'],
          inputRoles: [{ id: 'A', role: 'sink' }],
          outputRoles: [{ id: 'S2', role: 'continuation' }],
        },
        {
          id: 'S2',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          itemId: 'Desc_OreIron_C',
          inputs: ['A'],
          outputs: ['B'],
          directInputs: ['S1'],
          directOutputs: ['B'],
          inputRoles: [{ id: 'S1', role: 'continuation' }],
          outputRoles: [{ id: 'B', role: 'tap' }],
        },
      ],
      transportRuns: [
        {
          id: 'run-S1-S2',
          medium: 'belt',
          typeId: 'Build_ConveyorBeltMk1_C',
          fromNodeId: 'S1',
          toNodeId: 'S2',
          itemId: 'Desc_OreIron_C',
          capacity: 60,
          segmentCount: 1,
          segmentIds: ['belt-S1-S2'],
        },
      ],
    });
    const result = analyzeModel(splitModel).supplyLines[0];
    expect(result.nodes['run-S1-S2']).toMatchObject({
      type: 'transport',
      capacity: 60,
    });
    expect(result.nodes.S1).toMatchObject({ type: 'control' });
    if (result.nodes.S1.type === 'control') {
      expect(result.nodes.S1.outputs[0]?.nextNodeIds).toContain('run-S1-S2');
    }
  });

  it('uses the inferred item for a splitter output to another control', () => {
    const splitModel = model({
      buildings: [source, smelter, secondSmelter],
      lines: [line('line-1', ['A', 'B', 'C'], { name: 'Split line', flows: [] })],
    });
    const result = buildSupplyLineModel(splitModel, splitModel.lines[0], gameData, {
      transportNodes: [
        {
          id: 'S1',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          inputs: ['A'],
          outputs: ['B', 'C'],
          directInputs: ['A'],
          directOutputs: ['S2'],
          inputRoles: [{ id: 'A', role: 'sink' }],
          outputRoles: [{ id: 'S2', role: 'continuation' }],
        },
        {
          id: 'S2',
          typeId: 'Build_ConveyorAttachmentSplitter_C',
          kind: 'splitter',
          inputs: ['S1'],
          outputs: ['B', 'C'],
          directInputs: ['S1'],
          directOutputs: ['B', 'C'],
          inputRoles: [{ id: 'S1', role: 'continuation' }],
          outputRoles: [
            { id: 'B', role: 'tap' },
            { id: 'C', role: 'tap' },
          ],
        },
      ],
      transportRuns: [],
    });
    const splitter = result.nodes.S1;
    expect(splitter.type).toBe('control');
    if (splitter.type === 'control') {
      expect(splitter.outputs).toHaveLength(1);
      expect(splitter.outputs[0]).toMatchObject({
        itemId: 'Desc_OreIron_C',
        actualRate: 60,
      });
      expect(splitter.outputs[0].unknown).not.toBe(true);
    }
  });

  it('redistributes splitter flow when one output belt is slower', () => {
    const result = splitterWithRuns([20, 60]);
    expect(result.nodes['run-B']).toMatchObject({ type: 'transport', actualRate: 20 });
    expect(result.nodes['run-C']).toMatchObject({ type: 'transport', actualRate: 40 });
    expect(result.nodes.S1).toMatchObject({ type: 'control', bottleneck: false });
    const splitter = result.nodes.S1;
    expect(splitter.type).toBe('control');
    if (splitter.type === 'control') {
      expect(splitter.outputs.map((port) => port.actualRate).sort((a, b) => a - b)).toEqual([
        20, 40,
      ]);
    }
  });

  it('marks a splitter as a bottleneck when its output belts cannot carry the input', () => {
    const result = splitterWithRuns([20, 30]);
    expect(result.nodes['run-B']).toMatchObject({ actualRate: 20 });
    expect(result.nodes['run-C']).toMatchObject({ actualRate: 30 });
    expect(result.nodes.S1).toMatchObject({ type: 'control', bottleneck: true });
    expect(result.summary.bottlenecks).toContainEqual(
      expect.objectContaining({
        nodeId: 'S1',
        itemId: 'Desc_OreIron_C',
        expectedRate: 60,
        actualRate: 50,
        reason: 'Splitter output belts limit flow',
      }),
    );
  });

  it('does not mark a splitter as limited when an output capacity is unknown', () => {
    const result = splitterWithRuns([20, undefined]);
    expect(result.nodes['run-C']).toMatchObject({ unknown: true });
    expect(result.nodes.S1).toMatchObject({ type: 'control', bottleneck: false });
    expect(
      result.summary.bottlenecks.filter(
        (entry) => entry.reason === 'Splitter output belts limit flow',
      ),
    ).toEqual([]);
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

  it('keeps one output port with multiple next nodes', () => {
    const sourceA = building('A', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 60 }) });
    const b = building('B', { typeId: 'Build_SmelterMk1_C', inputs: rates({ Desc_OreIron_C: 30 }), outputs: rates({ Desc_IronIngot_C: 15 }) });
    const c = building('C', { typeId: 'Build_SmelterMk1_C', inputs: rates({ Desc_OreIron_C: 30 }), outputs: rates({ Desc_IronIngot_C: 15 }) });
    const l = line('line-1', ['A', 'B', 'C'], {
      flows: [
        { from: 'A', to: 'B', itemId: 'Desc_OreIron_C', rate: 30 },
        { from: 'A', to: 'C', itemId: 'Desc_OreIron_C', rate: 30 },
      ],
    });
    const m = model({ buildings: [sourceA, b, c], lines: [l] });
    const result = buildSupplyLineModel(m, l, gameData, { transportNodes: [], transportRuns: [] });
    const sourceNode = result.nodes.A;
    expect(sourceNode.type).toBe('source');
    expect(sourceNode.outputs).toHaveLength(1);
    expect(sourceNode.outputs[0].nextNodeIds).toEqual(expect.arrayContaining(['B', 'C']));
  });
});
