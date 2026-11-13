import { describe, expect, it } from 'vitest';
import {
  gameData,
  itemForm,
  itemName,
  resolveTypeId,
  validateGameData,
} from '../api/gameData';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('game data', () => {
  it('validates the bundled dataset', () => {
    expect(validateGameData(clone(gameData))).toEqual(gameData);
    expect(gameData.gameVersion).toBe('1.2');
    expect(gameData.sourceSha256).toHaveLength(64);
    expect(Object.keys(gameData.recipes).length).toBeGreaterThan(250);
  });

  it('has resolvable items, machines, extractors and generators', () => {
    for (const recipe of Object.values(gameData.recipes)) {
      for (const entry of [...recipe.inputs, ...recipe.outputs]) {
        expect(gameData.items[entry.item], `${recipe.id} -> ${entry.item}`).toBeDefined();
      }
    }
    for (const machineId of Object.keys(gameData.machines)) {
      expect(
        Object.values(gameData.recipes).some((recipe) => recipe.producedIn.includes(machineId)),
        machineId,
      ).toBe(true);
    }
    for (const extractor of Object.values(gameData.extractors)) {
      for (const item of extractor.allowedResources) {
        expect(gameData.items[item], `${extractor.id} -> ${item}`).toBeDefined();
      }
    }
    for (const generator of Object.values(gameData.generators)) {
      for (const fuel of generator.fuels) {
        if (fuel.item) {
          expect(gameData.items[fuel.item]).toBeDefined();
          expect(fuel.energyMJ).toBeGreaterThan(0);
        }
        if (fuel.supplement) {
          expect(gameData.items[fuel.supplement]).toBeDefined();
          expect(fuel.supplementRate).toBeGreaterThan(0);
        }
        if (fuel.byproduct) expect(gameData.items[fuel.byproduct]).toBeDefined();
      }
    }
    for (const belt of Object.values(gameData.belts)) expect(belt.rate).toBeGreaterThan(0);
    for (const pipe of Object.values(gameData.pipes)) expect(pipe.rate).toBeGreaterThan(0);
  });

  it('includes fuel energy and generator burn metadata', () => {
    expect(gameData.items.Desc_Coal_C.energyMJ).toBe(300);
    expect(gameData.items.Desc_Coal_C.stackSize).toBe(100);
    expect(gameData.items.Desc_IronPlate_C.stackSize).toBe(200);
    expect(gameData.items.Desc_LiquidFuel_C.energyMJ).toBe(750);
    expect(gameData.generators.Build_GeneratorCoal_C.fuels[0]).toMatchObject({
      item: 'Desc_Coal_C',
      energyMJ: 300,
      supplement: 'Desc_Water_C',
      supplementRate: 45,
    });
    expect(gameData.generators.Build_GeneratorNuclear_C.fuels[0]).toMatchObject({
      item: 'Desc_NuclearFuelRod_C',
      byproduct: 'Desc_NuclearWaste_C',
      byproductAmount: 50,
    });
  });

  it('includes the no-input Excited Photonic Matter recipe and converts fluid amounts', () => {
    expect(gameData.recipes.Recipe_QuantumEnergy_C).toMatchObject({
      name: 'Excited Photonic Matter',
      inputs: [],
      outputs: [{ item: 'Desc_QuantumEnergy_C', amount: 10 }],
      producedIn: ['Build_Converter_C'],
    });
    expect(gameData.items.Desc_QuantumEnergy_C.form).toBe('gas');
    expect(gameData.recipes.Recipe_LiquidFuel_C.inputs).toContainEqual({
      item: 'Desc_LiquidOil_C',
      amount: 6,
    });
    expect(gameData.recipes.Recipe_LiquidFuel_C.outputs).toContainEqual({
      item: 'Desc_LiquidFuel_C',
      amount: 4,
    });
  });

  it('resolves aliases and item helpers', () => {
    expect(resolveTypeId('Build_GeneratorBiomass_C')).toBe('Build_GeneratorBiomass_Automated_C');
    expect(resolveTypeId('Build_MinerMK1_C')).toBe('Build_MinerMk1_C');
    expect(resolveTypeId('Build_ConstructorMk1_C')).toBe('Build_ConstructorMk1_C');
    expect(itemName(gameData, 'Desc_IronPlate_C')).toBe('Iron Plate');
    expect(itemName(gameData, 'Desc_Missing_C')).toBe('Desc_Missing_C');
    expect(itemForm(gameData, 'Desc_Water_C')).toBe('liquid');
    expect(itemForm(gameData, 'Desc_Missing_C')).toBe('unknown');
  });

  it('rejects malformed datasets with specific messages', () => {
    const expectFailure = (mutate: (data: ReturnType<typeof clone<typeof gameData>>) => void, message: RegExp) => {
      const data = clone(gameData);
      mutate(data);
      expect(() => validateGameData(data)).toThrow(message);
    };

    expectFailure((data) => { data.schemaVersion = 3; }, /Unsupported game data schema version/);
    expectFailure((data) => { (data as unknown as { items: unknown }).items = []; }, /must be an object/);
    expectFailure((data) => { data.items.Desc_IronPlate_C.name = ''; }, /items.Desc_IronPlate_C.name/);
    expectFailure((data) => { data.recipes.Recipe_IronPlate_C.duration = Number.NaN; }, /duration/);
    expectFailure((data) => { data.recipes.Recipe_IronPlate_C.inputs = undefined as never; }, /input and output/);
    expectFailure((data) => { data.recipes.Recipe_IronPlate_C.producedIn = undefined as never; }, /producedIn/);
    expectFailure((data) => { data.machines.Build_ConstructorMk1_C.basePower = Number.NaN; }, /basePower/);
    expectFailure((data) => { data.extractors.Build_MinerMk1_C.name = ''; }, /extractors.Build_MinerMk1_C.name/);
    expectFailure((data) => { data.extractors.Build_MinerMk1_C.allowedResources = undefined as never; }, /allowedResources/);
    expectFailure((data) => { data.generators.Build_GeneratorCoal_C.fuels = undefined as never; }, /fuels/);
    expectFailure((data) => { data.belts.Build_ConveyorBeltMk1_C.rate = Number.NaN; }, /rate/);
    expectFailure((data) => { data.pipes.Build_Pipeline_C.rate = Number.NaN; }, /rate/);
  });
});
