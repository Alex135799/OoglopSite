import rawGameData from '../data/game-data-1.2.json';
import type { ItemForm } from '../domain/types';

export interface GameItem {
  id: string;
  name: string;
  form: ItemForm;
  energyMJ: number;
  stackSize: number;
  sinkPoints: number;
}

export interface GameRecipeAmount {
  item: string;
  amount: number;
}

export interface GameRecipe {
  id: string;
  name: string;
  duration: number;
  inputs: GameRecipeAmount[];
  outputs: GameRecipeAmount[];
  producedIn: string[];
  variablePower?: { constant: number; factor: number };
}

export interface GameMachine {
  id: string;
  name: string;
  basePower: number;
  powerExponent: number;
  boostPowerExponent: number;
  shardSlots: number;
}

export interface GameExtractor {
  id: string;
  name: string;
  baseRate: number;
  form: ItemForm;
  basePower: number;
  powerExponent: number;
  allowedResources: string[];
}

export interface GameGeneratorFuel {
  item?: string;
  energyMJ: number;
  supplement?: string;
  supplementRate?: number;
  byproduct?: string;
  byproductAmount: number;
}

export interface GameGenerator {
  id: string;
  name: string;
  powerProduction: number;
  fuels: GameGeneratorFuel[];
}

export interface GameTransport {
  id: string;
  name: string;
  rate: number;
}

export interface GameData {
  schemaVersion: number;
  gameVersion: string;
  saveVersionMax: number;
  sourceUrl: string;
  sourceCommit: string;
  sourceSha256: string;
  attribution: string;
  items: Record<string, GameItem>;
  recipes: Record<string, GameRecipe>;
  machines: Record<string, GameMachine>;
  extractors: Record<string, GameExtractor>;
  generators: Record<string, GameGenerator>;
  belts: Record<string, GameTransport>;
  pipes: Record<string, GameTransport>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireRecord = (value: unknown, field: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(`Game data field "${field}" must be an object`);
  return value;
};

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Game data field "${field}" must be a non-empty string`);
  }
  return value;
};

const requireNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Game data field "${field}" must be a finite number`);
  }
  return value;
};

export const validateGameData = (input: unknown): GameData => {
  const data = requireRecord(input, 'root');
  const schemaVersion = requireNumber(data.schemaVersion, 'schemaVersion');
  if (schemaVersion !== 2) throw new Error(`Unsupported game data schema version ${schemaVersion}`);

  const items = requireRecord(data.items, 'items') as Record<string, GameItem>;
  const recipes = requireRecord(data.recipes, 'recipes') as Record<string, GameRecipe>;
  const machines = requireRecord(data.machines, 'machines') as Record<string, GameMachine>;
  const extractors = requireRecord(data.extractors, 'extractors') as Record<string, GameExtractor>;
  const generators = requireRecord(data.generators, 'generators') as Record<string, GameGenerator>;
  const belts = requireRecord(data.belts, 'belts') as Record<string, GameTransport>;
  const pipes = requireRecord(data.pipes, 'pipes') as Record<string, GameTransport>;

  for (const [id, item] of Object.entries(items)) {
    requireString(item?.id, `items.${id}.id`);
    requireString(item?.name, `items.${id}.name`);
    requireString(item?.form, `items.${id}.form`);
    requireNumber(item?.energyMJ, `items.${id}.energyMJ`);
    requireNumber(item?.stackSize, `items.${id}.stackSize`);
  }
  for (const [id, recipe] of Object.entries(recipes)) {
    requireString(recipe?.id, `recipes.${id}.id`);
    requireString(recipe?.name, `recipes.${id}.name`);
    requireNumber(recipe?.duration, `recipes.${id}.duration`);
    if (!Array.isArray(recipe?.inputs) || !Array.isArray(recipe?.outputs)) {
      throw new Error(`Game data recipe "${id}" must have input and output arrays`);
    }
    if (!Array.isArray(recipe.producedIn)) {
      throw new Error(`Game data recipe "${id}" must have a producedIn array`);
    }
  }
  for (const [id, machine] of Object.entries(machines)) {
    requireString(machine?.name, `machines.${id}.name`);
    requireNumber(machine?.basePower, `machines.${id}.basePower`);
    requireNumber(machine?.powerExponent, `machines.${id}.powerExponent`);
    requireNumber(machine?.boostPowerExponent, `machines.${id}.boostPowerExponent`);
    requireNumber(machine?.shardSlots, `machines.${id}.shardSlots`);
  }
  for (const [id, extractor] of Object.entries(extractors)) {
    requireString(extractor?.name, `extractors.${id}.name`);
    requireNumber(extractor?.baseRate, `extractors.${id}.baseRate`);
    requireNumber(extractor?.basePower, `extractors.${id}.basePower`);
    if (!Array.isArray(extractor.allowedResources)) {
      throw new Error(`Game data extractor "${id}" must have an allowedResources array`);
    }
  }
  for (const [id, generator] of Object.entries(generators)) {
    requireString(generator?.name, `generators.${id}.name`);
    requireNumber(generator?.powerProduction, `generators.${id}.powerProduction`);
    if (!Array.isArray(generator?.fuels)) {
      throw new Error(`Game data generator "${id}" must have a fuels array`);
    }
    for (const fuel of generator.fuels) {
      if (fuel.item) requireNumber(fuel.energyMJ, `generators.${id}.fuels.energyMJ`);
      if (fuel.supplement) {
        requireString(fuel.supplement, `generators.${id}.fuels.supplement`);
        if (fuel.supplementRate !== undefined) {
          requireNumber(fuel.supplementRate, `generators.${id}.fuels.supplementRate`);
        }
      }
    }
  }
  for (const [id, belt] of Object.entries(belts)) {
    requireNumber(belt?.rate, `belts.${id}.rate`);
  }
  for (const [id, pipe] of Object.entries(pipes)) {
    requireNumber(pipe?.rate, `pipes.${id}.rate`);
  }

  return {
    schemaVersion,
    gameVersion: requireString(data.gameVersion, 'gameVersion'),
    saveVersionMax: requireNumber(data.saveVersionMax, 'saveVersionMax'),
    sourceUrl: requireString(data.sourceUrl, 'sourceUrl'),
    sourceCommit: requireString(data.sourceCommit, 'sourceCommit'),
    sourceSha256: requireString(data.sourceSha256, 'sourceSha256'),
    attribution: requireString(data.attribution, 'attribution'),
    items,
    recipes,
    machines,
    extractors,
    generators,
    belts,
    pipes,
  };
};

export const gameData: GameData = validateGameData(rawGameData);

const TYPE_ALIASES: Record<string, string> = {
  Build_GeneratorBiomass_C: 'Build_GeneratorBiomass_Automated_C',
  Build_GeneratorIntegratedBiomass_C: 'Build_GeneratorBiomass_Automated_C',
  Build_MinerMK1_C: 'Build_MinerMk1_C',
};

export const resolveTypeId = (id: string): string => TYPE_ALIASES[id] ?? id;

export const itemName = (data: GameData, itemId: string): string =>
  data.items[itemId]?.name ?? itemId;

export const itemForm = (data: GameData, itemId: string): ItemForm =>
  data.items[itemId]?.form ?? 'unknown';
