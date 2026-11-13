import { describe, expect, it } from 'vitest';
import { buildProductionGroups, assignGroupRows } from '../components/productionLayout';
import { collapseTransport } from '../components/lineGraphLayout';
import { buildSupplyLineModel } from '../domain/buildSupplyLineModel';
import { gameData } from '../api/gameData';
import { building, line, model, rates } from './helpers';

describe('production layout', () => {
  const miner = building('Miner', {
    typeId: 'Build_MinerMk1_C',
    displayName: 'Miner',
    outputs: rates({ Desc_OreIron_C: 60 }),
  });
  const smelter = building('Smelter', {
    typeId: 'Build_SmelterMk1_C',
    recipeId: 'Recipe_IngotIron_C',
    recipeName: 'Iron Ingot',
    inputs: rates({ Desc_OreIron_C: 30 }),
    outputs: rates({ Desc_IronIngot_C: 30 }),
  });
  const constructor = building('Constructor', {
    typeId: 'Build_ConstructorMk1_C',
    recipeId: 'Recipe_IronPlate_C',
    recipeName: 'Iron Plate',
    inputs: rates({ Desc_IronIngot_C: 30 }),
    outputs: rates({ Desc_Plate_C: 20 }),
  });
  const sourceModel = model({
    buildings: [miner, smelter, constructor],
    lines: [
      line('line-1', ['Miner', 'Smelter', 'Constructor'], {
        name: 'Tier line',
        flows: [
          { from: 'Miner', to: 'Smelter', itemId: 'Desc_OreIron_C', rate: 30 },
          { from: 'Smelter', to: 'Constructor', itemId: 'Desc_IronIngot_C', rate: 30 },
        ],
      }),
    ],
  });
  const supply = buildSupplyLineModel(sourceModel, sourceModel.lines[0], gameData, {
    transportNodes: [],
    transportRuns: [],
  });

  it('assigns extractor, converter, and downstream tiers', () => {
    const groups = buildProductionGroups(supply, collapseTransport(supply));
    expect(groups.find((group) => group.buildingIds.includes('Miner'))?.tier).toBe(0);
    expect(groups.find((group) => group.buildingIds.includes('Smelter'))?.tier).toBe(1);
    expect(groups.find((group) => group.buildingIds.includes('Constructor'))?.tier).toBe(2);
  });

  it('groups matching recipes with the same upstream producer set', () => {
    const secondSmelter = building('Smelter2', {
      typeId: 'Build_SmelterMk1_C',
      recipeId: 'Recipe_IngotIron_C',
      recipeName: 'Iron Ingot',
      inputs: rates({ Desc_OreIron_C: 30 }),
      outputs: rates({ Desc_IronIngot_C: 30 }),
    });
    const groupedModel = model({
      buildings: [miner, smelter, secondSmelter],
      lines: [
        line('line-1', ['Miner', 'Smelter', 'Smelter2'], {
          name: 'Grouped line',
          flows: [
            { from: 'Miner', to: 'Smelter', itemId: 'Desc_OreIron_C', rate: 30 },
            { from: 'Miner', to: 'Smelter2', itemId: 'Desc_OreIron_C', rate: 30 },
          ],
        }),
      ],
    });
    const groupedSupply = buildSupplyLineModel(
      groupedModel,
      groupedModel.lines[0],
      gameData,
      { transportNodes: [], transportRuns: [] },
    );
    const groups = buildProductionGroups(groupedSupply, collapseTransport(groupedSupply));
    expect(groups.filter((group) => group.tier === 1)).toHaveLength(1);
    expect(groups.find((group) => group.tier === 1)?.buildingIds).toEqual([
      'Smelter',
      'Smelter2',
    ]);
  });

  it('creates deterministically assigned shared rows', () => {
    const groups = buildProductionGroups(supply, collapseTransport(supply));
    const first = assignGroupRows(groups);
    const second = assignGroupRows(groups);
    expect([...first.entries()]).toEqual([...second.entries()]);
    expect(new Set(first.values()).size).toBeGreaterThan(0);
  });
});
