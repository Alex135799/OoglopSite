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

  const splitterWithRuns = (
    capacities: [number | undefined, number | undefined],
    cInput = 30,
  ) => {
    const c = cInput === 30
      ? secondSmelter
      : building('C', {
          typeId: 'Build_SmelterMk1_C',
          displayName: 'Smelter',
          recipeId: 'Recipe_IngotIron_C',
          recipeName: 'Iron Ingot',
          inputs: rates({ Desc_OreIron_C: cInput }),
          outputs: rates({ Desc_IronIngot_C: cInput / 2 }),
          powerConsumption: 4,
        });
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
      buildings: [source, smelter, c],
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
    const result = splitterWithRuns([20, 60], 60);
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
        reason: 'Splitter output capacity limits flow',
      }),
    );
  });

  it('limits generator power by fuel and water supply', () => {
    const fuel = building('Fuel', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_Coal_C: 7.5 }) });
    const water = building('Water', { typeId: 'Build_WaterPump_C', outputs: rates({ Desc_Water_C: 60 }) });
    const generator = building('Generator', {
      typeId: 'Build_GeneratorCoal_C',
      displayName: 'Coal Generator',
      inputs: rates({ Desc_Coal_C: 15, Desc_Water_C: 45 }),
      outputs: rates({ Desc_NuclearWaste_C: 10 }),
      powerGeneration: 75,
    });
    const generatorModel = model({
      buildings: [fuel, water, generator],
      lines: [
        line('line-1', ['Fuel', 'Water', 'Generator'], {
          name: 'Coal line',
          flows: [
            { from: 'Fuel', to: 'Generator', itemId: 'Desc_Coal_C', rate: 7.5 },
            { from: 'Water', to: 'Generator', itemId: 'Desc_Water_C', rate: 45 },
          ],
        }),
      ],
    });
    const result = buildSupplyLineModel(generatorModel, generatorModel.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.nodes.Generator).toMatchObject({
      type: 'transformer',
      kind: 'generator',
      expectedPowerGeneration: 75,
      actualPowerGeneration: 37.5,
      limitedBy: 'input',
    });
    const generatorNode = result.nodes.Generator;
    if (generatorNode.type === 'transformer') {
      expect(generatorNode.outputs[0]?.actualRate).toBe(5);
    }
  });

  it('merges and routes flow through a pipe junction control', () => {
    const a = building('A', { typeId: 'Build_WaterPump_C', outputs: rates({ Desc_Water_C: 60 }) });
    const b = building('B', { typeId: 'Build_WaterPump_C', outputs: rates({ Desc_Water_C: 60 }) });
    const c = building('C', {
      typeId: 'Build_Refinery_C',
      recipeId: 'Recipe_Test_C',
      inputs: rates({ Desc_Water_C: 60 }),
      outputs: rates({ Desc_Product_C: 30 }),
    });
    const junctionModel = model({
      buildings: [a, b, c],
      lines: [line('line-1', ['A', 'B', 'C'], { name: 'Water line', flows: [] })],
    });
    const result = buildSupplyLineModel(junctionModel, junctionModel.lines[0], gameData, {
      transportNodes: [
        {
          id: 'J1',
          typeId: 'Build_PipelineJunction_Cross_C',
          kind: 'junction',
          itemId: 'Desc_Water_C',
          inputs: ['A', 'B'],
          outputs: ['C'],
          directInputs: ['A', 'B'],
          directOutputs: ['C'],
          inputRoles: [
            { id: 'A', role: 'sink' },
            { id: 'B', role: 'sink' },
          ],
          outputRoles: [{ id: 'C', role: 'tap' }],
        },
      ],
      transportRuns: [],
    });
    expect(result.nodes.J1).toMatchObject({
      type: 'control',
      kind: 'junction',
      actualThroughput: 60,
    });
    if (result.nodes.C.type === 'transformer') {
      expect(result.nodes.C.inputs[0]?.actualRate).toBe(60);
    }
  });

  it('keeps nameplate power when generator fuel type is unknown', () => {
    const generator = building('Generator', {
      typeId: 'Build_GeneratorFuel_C',
      displayName: 'Fuel Generator',
      inputs: [],
      outputs: [],
      powerGeneration: 250,
      fuelUnknown: true,
    });
    const generatorModel = model({
      buildings: [generator],
      lines: [line('line-1', ['Generator'], { name: 'Generator line', flows: [] })],
    });
    const result = buildSupplyLineModel(generatorModel, generatorModel.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.nodes.Generator).toMatchObject({
      type: 'transformer',
      kind: 'generator',
      expectedPowerGeneration: 250,
      actualPowerGeneration: 250,
      limitedBy: 'unknown',
    });
  });

  it('supplies generator fuel from an upstream storage source', () => {
    const generator = building('Generator', {
      typeId: 'Build_GeneratorBiomass_Automated_C',
      displayName: 'Biomass Burner',
      inputs: rates({ Desc_PackagedBiofuel_C: 2.4 }),
      outputs: [],
      powerGeneration: 30,
      selectedFuel: 'Desc_PackagedBiofuel_C',
    });
    const generatorModel = model({
      buildings: [generator],
      lines: [line('line-1', ['Generator'], { name: 'Generator line', flows: [] })],
    });
    const result = buildSupplyLineModel(generatorModel, generatorModel.lines[0], gameData, {
      transportNodes: [
        {
          id: 'Storage',
          typeId: 'Build_StorageContainerMk1_C',
          kind: 'storage',
          itemId: 'Desc_PackagedBiofuel_C',
          inputs: [],
          outputs: ['Generator'],
          directInputs: [],
          directOutputs: ['Generator'],
          inputRoles: [],
          outputRoles: [{ id: 'Generator', role: 'tap' }],
        },
      ],
      transportRuns: [],
    });
    expect(result.nodes.Generator).toMatchObject({
      type: 'transformer',
      actualPowerGeneration: 30,
    });
    if (result.nodes.Generator.type === 'transformer') {
      expect(result.nodes.Generator.inputs[0]?.actualRate).toBe(2.4);
    }
  });

  it('uses internal generator fuel when no fuel edge exists', () => {
    const generator = building('Generator', {
      typeId: 'Build_GeneratorBiomass_Automated_C',
      displayName: 'Biomass Burner',
      inputs: rates({ Desc_PackagedBiofuel_C: 2.4 }),
      outputs: [],
      powerGeneration: 30,
      selectedFuel: 'Desc_PackagedBiofuel_C',
      fuelBuffer: {
        itemId: 'Desc_PackagedBiofuel_C',
        amount: 100,
        runtimeMinutes: 41.6667,
      },
    });
    const generatorModel = model({
      buildings: [generator],
      lines: [line('line-1', ['Generator'], { name: 'Generator line', flows: [] })],
    });
    const result = buildSupplyLineModel(generatorModel, generatorModel.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.nodes.Generator).toMatchObject({
      type: 'transformer',
      kind: 'generator',
      expectedPowerGeneration: 30,
      actualPowerGeneration: 30,
    });
  });

  it('does not report a demand-limited transformer as input-starved', () => {
    const a = building('A', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 60 }) });
    const b = building('B', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      inputs: rates({ Desc_OreIron_C: 30 }),
      outputs: rates({ Desc_IronIngot_C: 30 }),
    });
    const c = building('C', {
      typeId: 'Build_ConstructorMk1_C',
      recipeId: 'Recipe_IronPlate_C',
      inputs: rates({ Desc_IronIngot_C: 15 }),
      outputs: rates({ Desc_IronPlate_C: 10 }),
    });
    const demandModel = model({
      buildings: [a, b, c],
      lines: [
        line('line-1', ['A', 'B', 'C'], {
          name: 'Demand-limited line',
          flows: [
            { from: 'A', to: 'B', itemId: 'Desc_OreIron_C', rate: 30 },
            { from: 'B', to: 'C', itemId: 'Desc_IronIngot_C', rate: 15 },
          ],
        }),
      ],
    });
    const result = buildSupplyLineModel(demandModel, demandModel.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    expect(result.nodes.B).toMatchObject({
      type: 'transformer',
      limitedBy: 'demand',
    });
    expect(result.summary.bottlenecks).not.toContainEqual(
      expect.objectContaining({ nodeId: 'B', reason: 'Transformer input starvation' }),
    );
  });

  it('scales every input demand when a multi-input machine is supply-limited', () => {
    const ore = building('Ore', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 30 }) });
    const water = building('Water', { typeId: 'Build_WaterPump_C', outputs: rates({ Desc_Water_C: 60 }) });
    const machine = building('Machine', {
      typeId: 'Build_Converter_C',
      recipeId: 'Recipe_Test_C',
      inputs: rates({ Desc_OreIron_C: 60, Desc_Water_C: 60 }),
      outputs: rates({ Desc_Product_C: 30 }),
    });
    const demandModel = model({
      buildings: [ore, water, machine],
      lines: [
        line('line-1', ['Ore', 'Water', 'Machine'], {
          name: 'Multi-input line',
          flows: [
            { from: 'Ore', to: 'Machine', itemId: 'Desc_OreIron_C', rate: 30 },
            { from: 'Water', to: 'Machine', itemId: 'Desc_Water_C', rate: 60 },
          ],
        }),
      ],
    });
    const result = buildSupplyLineModel(demandModel, demandModel.lines[0], gameData, {
      transportNodes: [],
      transportRuns: [],
    });
    const node = result.nodes.Machine;
    expect(node).toMatchObject({ type: 'transformer', limitedBy: 'input' });
    if (node.type === 'transformer') {
      expect(node.inputs.find((port) => port.itemId === 'Desc_Water_C')?.actualRate).toBe(30);
    }
  });

  it('caps machine input demand and redistributes the surplus', () => {
    const a = building('A', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 120 }) });
    const b = building('B', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      inputs: rates({ Desc_OreIron_C: 45 }),
      outputs: rates({ Desc_IronIngot_C: 15 }),
    });
    const c = building('C', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      inputs: rates({ Desc_OreIron_C: 75 }),
      outputs: rates({ Desc_IronIngot_C: 25 }),
    });
    const demandModel = model({
      buildings: [a, b, c],
      lines: [line('line-1', ['A', 'B', 'C'], { name: 'Demand line', flows: [] })],
    });
    const result = buildSupplyLineModel(demandModel, demandModel.lines[0], gameData, {
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
    expect(result.nodes.B).toMatchObject({ type: 'transformer' });
    expect(result.nodes.C).toMatchObject({ type: 'transformer' });
    if (result.nodes.B.type === 'transformer' && result.nodes.C.type === 'transformer') {
      expect(result.nodes.B.inputs[0]?.actualRate).toBe(45);
      expect(result.nodes.C.inputs[0]?.actualRate).toBe(75);
    }
    expect(result.nodes.S1).toMatchObject({ type: 'control', bottleneck: false });
  });

  it('marks a splitter demand-limited when no branch can absorb the surplus', () => {
    const a = building('A', { typeId: 'Build_MinerMk1_C', outputs: rates({ Desc_OreIron_C: 120 }) });
    const b = building('B', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      inputs: rates({ Desc_OreIron_C: 45 }),
      outputs: rates({ Desc_IronIngot_C: 15 }),
    });
    const c = building('C', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      inputs: rates({ Desc_OreIron_C: 45 }),
      outputs: rates({ Desc_IronIngot_C: 15 }),
    });
    const demandModel = model({
      buildings: [a, b, c],
      lines: [line('line-1', ['A', 'B', 'C'], { name: 'Demand line', flows: [] })],
    });
    const result = buildSupplyLineModel(demandModel, demandModel.lines[0], gameData, {
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
      bottleneck: true,
      bottleneckReason: 'demand',
    });
    expect(result.summary.bottlenecks).toContainEqual(
      expect.objectContaining({
        nodeId: 'S1',
        expectedRate: 120,
        actualRate: 90,
        reason: 'Splitter downstream demand limits flow',
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
