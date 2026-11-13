import { describe, expect, it } from 'vitest';
import { analyzeModel } from '../domain/analyzeModel';
import { building, line, model } from './helpers';

describe('analyzeModel', () => {
  it('merges generator lines connected through a storage transport node', () => {
    const generatorA = building('GeneratorA', {
      typeId: 'Build_GeneratorBiomass_Automated_C',
      displayName: 'Biomass Burner',
      powerGeneration: 30,
    });
    const generatorB = building('GeneratorB', {
      typeId: 'Build_GeneratorBiomass_Automated_C',
      displayName: 'Biomass Burner',
      powerGeneration: 30,
    });
    const sourceModel = model({
      buildings: [generatorA, generatorB],
      lines: [
        line('line-1', ['GeneratorA'], { name: 'A', flows: [] }),
        line('line-2', ['GeneratorB'], { name: 'B', flows: [] }),
      ],
      transportNodes: [
        {
          id: 'Storage',
          typeId: 'Build_StorageContainerMk1_C',
          kind: 'storage',
          itemId: 'Desc_PackagedBiofuel_C',
          contents: [{ itemId: 'Desc_PackagedBiofuel_C', amount: 42 }],
          inputs: [],
          outputs: ['GeneratorA', 'GeneratorB'],
          directInputs: [],
          directOutputs: ['GeneratorA', 'GeneratorB'],
          inputRoles: [],
          outputRoles: [
            { id: 'GeneratorA', role: 'tap' },
            { id: 'GeneratorB', role: 'tap' },
          ],
        },
      ],
      transportRuns: [],
    });
    const analysis = analyzeModel(sourceModel);
    expect(analysis.supplyLines).toHaveLength(1);
    expect(analysis.supplyLines[0].buildingIds).toEqual(['GeneratorA', 'GeneratorB']);
    expect(analysis.supplyLines[0].nodes.Storage).toMatchObject({
      type: 'control',
      kind: 'storage',
      contents: [{ itemId: 'Desc_PackagedBiofuel_C', amount: 42 }],
    });
  });
});
