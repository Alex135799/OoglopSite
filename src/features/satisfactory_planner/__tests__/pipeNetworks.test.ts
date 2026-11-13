// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseSaveBuffer } from '../api/parseSave';
import { analyzeModel } from '../domain/analyzeModel';
import { building, line, model, rates } from './helpers';

describe('pipe networks', () => {
  it('connects the coal generator water network', async () => {
    const buffer = await readFile(new URL('../fixtures/Release-032.sav', import.meta.url));
    const model = parseSaveBuffer({
      fileName: 'Release-032.sav',
      buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      sha256: 'pipe-test',
      size: buffer.byteLength,
    });
    const generatorId = 'Persistent_Level:PersistentLevel.Build_GeneratorCoal_C_2147461819';
    const runs = (model.transportRuns ?? []).filter(
      (run) => run.medium === 'pipe' && run.toNodeId === generatorId,
    );
    expect(runs.some((run) => run.itemId === 'Desc_Water_C' && run.capacity === 600)).toBe(true);

    const analysis = analyzeModel(model);
    const line = analysis.supplyLines.find((entry) => entry.nodes[generatorId]);
    expect(line).toBeDefined();
    const generator = line!.nodes[generatorId];
    expect(generator).toMatchObject({ type: 'transformer', kind: 'generator' });
    if (generator.type === 'transformer') {
      expect(generator.inputs.find((port) => port.itemId === 'Desc_Water_C')?.actualRate).toBe(45);
      expect(generator.actualPowerGeneration).toBe(75);
    }
    const junction = Object.values(line!.nodes).find(
      (node) => node.type === 'control' && node.kind === 'junction',
    );
    expect(junction).toMatchObject({ type: 'control', kind: 'junction' });
    if (junction?.type === 'control') {
      expect(junction.inputs.map((port) => port.actualRate).sort((a, b) => a - b)).toEqual([
        120, 120,
      ]);
      expect(junction.outputs.some((port) => port.actualRate === 45)).toBe(true);
    }
    const pumpIds = [
      'Persistent_Level:PersistentLevel.Build_WaterPump_C_2147189368',
      'Persistent_Level:PersistentLevel.Build_WaterPump_C_2147189740',
    ];
    for (const pumpId of pumpIds) {
      expect(line!.nodes[pumpId]).toMatchObject({ type: 'source' });
    }
    const tankIds = [
      'Persistent_Level:PersistentLevel.Build_PipeStorageTank_C_2147356678',
      'Persistent_Level:PersistentLevel.Build_IndustrialTank_C_2147358101',
    ];
    for (const tankId of tankIds) {
      expect(line!.nodes[tankId]).toMatchObject({
        type: 'control',
        kind: 'tank',
        surplusRate: 97.5,
      });
      expect(analysis.findings).toContainEqual(
        expect.objectContaining({
          kind: 'tank_surplus',
          severity: 'warning',
          buildingIds: [tankId],
        }),
      );
    }
  }, 120000);

  it('marks a draining fluid tank critical with depletion time', () => {
    const pump = building('Pump', {
      typeId: 'Build_WaterPump_C',
      outputs: rates({ Desc_Water_C: 30 }),
    });
    const consumer = building('Consumer', {
      typeId: 'Build_Refinery_C',
      recipeId: 'Recipe_Test_C',
      inputs: rates({ Desc_Water_C: 60 }),
      outputs: rates({ Desc_Product_C: 30 }),
    });
    const tankModel = model({
      buildings: [pump, consumer],
      lines: [line('line-tank', ['Pump', 'Consumer'], { name: 'Tank line', flows: [] })],
      transportNodes: [
        {
          id: 'Tank',
          typeId: 'Build_PipeStorageTank_C',
          kind: 'tank',
          itemId: 'Desc_Water_C',
          storedAmount: 100,
          contents: [{ itemId: 'Desc_Water_C', amount: 100 }],
          inputs: ['Pump'],
          outputs: ['Consumer'],
          directInputs: ['Pump'],
          directOutputs: ['Consumer'],
          inputRoles: [{ id: 'Pump', role: 'sink' }],
          outputRoles: [{ id: 'Consumer', role: 'tap' }],
        },
      ],
      transportRuns: [],
    });
    const analysis = analyzeModel(tankModel);
    const tank = analysis.supplyLines[0].nodes.Tank;
    expect(tank).toMatchObject({ type: 'control', kind: 'tank' });
    if (tank.type === 'control') {
      expect(tank.depletionMinutes).toBeCloseTo(100 / 30, 2);
    }
    expect(analysis.findings).toContainEqual(
      expect.objectContaining({ kind: 'tank_depletion', severity: 'critical' }),
    );
  });
});
