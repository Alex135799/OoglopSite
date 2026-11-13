#!/usr/bin/env node
/*
 * Build the vendored Satisfactory 1.2 planner dataset from the game Docs.json.
 *
 * The source is a pinned copy of the game's Docs/en-US.json (UTF-16LE) from
 * aringadre76/satisfactory-api (MIT repository, data extracted from the game).
 * Run with: node scripts/build-game-data.mjs [--input path/to/Docs.json]
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/aringadre76/satisfactory-api/0429a63144cc3ca46999e054d0b53849a8e94c6b/Docs/en-US.json';
const SOURCE_COMMIT = '0429a63144cc3ca46999e054d0b53849a8e94c6b';
const SOURCE_SHA256 = '01cc810c229ce0a81848edbe1481be233e773e3cc4f8a3b662db2f86e86fb22a';
const GAME_VERSION = '1.2';
const DATASET_SCHEMA_VERSION = 2;
const SAVE_VERSION_MAX = 58;

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, '../src/features/satisfactory_planner/data/game-data-1.2.json');

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
const inputPath = inputIndex >= 0 ? args[inputIndex + 1] : undefined;

const decodeDocs = (buffer) => {
  let text = buffer.toString('utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
};

const toNumber = (value, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ITEM_PATH = /\b(Desc_[A-Za-z0-9_]+_C)\b/g;
const BUILD_PATH = /\b(Build_[A-Za-z0-9_]+_C)\b/g;

const itemIdsIn = (value) => {
  const found = new Set();
  if (typeof value !== 'string') return found;
  for (const match of value.matchAll(ITEM_PATH)) found.add(match[1]);
  return found;
};

const buildIdsIn = (value) => {
  const found = new Set();
  if (typeof value !== 'string') return found;
  for (const match of value.matchAll(BUILD_PATH)) found.add(match[1]);
  return found;
};

const parseItemAmounts = (value) => {
  if (typeof value !== 'string' || value.length === 0) return [];
  const amounts = [];
  const tuple = /ItemClass="[^"]*?\b(Desc_[A-Za-z0-9_]+_C)\b[^"]*?"\s*,\s*Amount=([\d.]+)/g;
  for (const match of value.matchAll(tuple)) {
    amounts.push({ item: match[1], amount: toNumber(match[2]) });
  }
  return amounts.filter((entry) => entry.amount > 0);
};

const formOf = (value) => {
  switch (value) {
    case 'RF_SOLID':
      return 'solid';
    case 'RF_LIQUID':
      return 'liquid';
    case 'RF_GAS':
      return 'gas';
    default:
      return 'unknown';
  }
};

const toDisplayAmount = (byName, item, amount) => {
  const form = formOf(byName.get(item)?.mForm);
  return form === 'liquid' || form === 'gas' ? amount / 1000 : amount;
};

const STACK_SIZES = {
  SS_ONE: 1,
  SS_SMALL: 50,
  SS_MEDIUM: 100,
  SS_BIG: 200,
  SS_HUGE: 500,
};

const energyPerDisplayUnit = (byName, item) => {
  const cls = byName.get(item);
  if (!cls) return 0;
  const energy = toNumber(cls.mEnergyValue);
  const form = formOf(cls.mForm);
  return form === 'liquid' || form === 'gas' ? energy * 1000 : energy;
};

const classIndex = (classes) => new Map(classes.map((entry) => [entry.ClassName, entry]));

const main = async () => {
  let buffer;
  if (inputPath) {
    buffer = await readFile(resolve(process.cwd(), inputPath));
  } else {
    const response = await fetch(SOURCE_URL);
    if (!response.ok) throw new Error(`Failed to download ${SOURCE_URL}: ${response.status}`);
    buffer = Buffer.from(await response.arrayBuffer());
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (!inputPath && sha256 !== SOURCE_SHA256) {
    throw new Error(`Source hash mismatch: expected ${SOURCE_SHA256}, got ${sha256}`);
  }

  const docs = decodeDocs(buffer);
  const classes = docs.flatMap((entry) => entry.Classes ?? []);
  const byName = classIndex(classes);

  const machineNames = new Set();
  const recipes = {};
  const referencedItems = new Set(['Desc_CrystalShard_C', 'Desc_WAT1_C']);

  for (const entry of classes) {
    if (!entry.ClassName?.startsWith('Recipe_')) continue;
    if (!entry.mProduct) continue;
    const producedIn = [...buildIdsIn(entry.mProducedIn)];
    if (producedIn.length === 0) continue;

    const inputs = parseItemAmounts(entry.mIngredients).map((parsed) => ({
      ...parsed,
      amount: toDisplayAmount(byName, parsed.item, parsed.amount),
    }));
    const outputs = parseItemAmounts(entry.mProduct).map((parsed) => ({
      ...parsed,
      amount: toDisplayAmount(byName, parsed.item, parsed.amount),
    }));
    const duration = toNumber(entry.mManufactoringDuration, 0);
    if (outputs.length === 0 || duration <= 0) continue;

    // Machine classes are only known after this loop, so collect candidates and
    // keep recipes that run in a real manufacturing building rather than the
    // build gun or workbench.
    const hasMachine = producedIn.some((id) => {
      const cls = byName.get(id);
      return Boolean(cls?.mPowerConsumption !== undefined && cls?.mProductionShardSlotSize !== undefined);
    });
    if (!hasMachine) continue;

    for (const produced of producedIn) {
      if (byName.get(produced)?.mPowerConsumption !== undefined) machineNames.add(produced);
    }
    for (const { item } of inputs) referencedItems.add(item);
    for (const { item } of outputs) referencedItems.add(item);

    recipes[entry.ClassName] = {
      id: entry.ClassName,
      name: entry.mDisplayName ?? entry.ClassName,
      duration,
      inputs,
      outputs,
      producedIn,
      variablePower:
        entry.mVariablePowerConsumptionConstant !== undefined
          ? {
              constant: toNumber(entry.mVariablePowerConsumptionConstant),
              factor: toNumber(entry.mVariablePowerConsumptionFactor, 1),
            }
          : undefined,
    };
  }

  const machines = {};
  for (const id of [...machineNames].sort()) {
    const cls = byName.get(id);
    if (!cls) continue;
    machines[id] = {
      id,
      name: cls.mDisplayName ?? id,
      basePower: toNumber(cls.mPowerConsumption),
      powerExponent: toNumber(cls.mPowerConsumptionExponent, 1),
      boostPowerExponent: toNumber(cls.mProductionBoostPowerConsumptionExponent, 2),
      shardSlots: toNumber(cls.mProductionShardSlotSize),
    };
  }

  const extractors = {};
  for (const cls of classes) {
    if (!cls.ClassName?.startsWith('Build_')) continue;
    if (cls.mExtractCycleTime === undefined || cls.mItemsPerCycle === undefined) continue;
    const cycleTime = toNumber(cls.mExtractCycleTime);
    const itemsPerCycle = toNumber(cls.mItemsPerCycle);
    if (cycleTime <= 0 || itemsPerCycle <= 0) continue;
    const form = cls.mAllowedResourceForms?.includes('RF_LIQUID')
      ? 'liquid'
      : cls.mAllowedResourceForms?.includes('RF_GAS')
        ? 'gas'
        : 'solid';
    extractors[cls.ClassName] = {
      id: cls.ClassName,
      name: cls.mDisplayName ?? cls.ClassName,
      baseRate: (itemsPerCycle / cycleTime) * 60 * (form === 'solid' ? 1 : 0.001),
      form,
      basePower: toNumber(cls.mPowerConsumption),
      powerExponent: toNumber(cls.mPowerConsumptionExponent, 1),
      allowedResources: [...itemIdsIn(cls.mAllowedResources)],
    };
    for (const item of itemIdsIn(cls.mAllowedResources)) referencedItems.add(item);
  }

  const generators = {};
  for (const cls of classes) {
    if (!cls.ClassName?.startsWith('Build_Generator')) continue;
    if (cls.mPowerProduction === undefined) continue;
    const powerProduction = toNumber(cls.mPowerProduction);
    const supplementRatio = toNumber(cls.mSupplementalToPowerRatio);
    const requiresSupplement =
      String(cls.mRequiresSupplementalResource).toLowerCase() === 'true' ||
      supplementRatio > 0;
    const fuels = Array.isArray(cls.mFuel)
      ? cls.mFuel.map((fuel) => {
          const item = itemIdsIn(fuel.mFuelClass).values().next().value;
          const supplement = itemIdsIn(fuel.mSupplementalResourceClass).values().next().value;
          return {
            item,
            energyMJ: energyPerDisplayUnit(byName, item),
            supplement,
            supplementRate:
              requiresSupplement && supplement
                ? powerProduction * 0.06 * supplementRatio
                : undefined,
            byproduct: itemIdsIn(fuel.mByproduct).values().next().value,
            byproductAmount: toNumber(fuel.mByproductAmount),
          };
        })
      : [];
    for (const fuel of fuels) {
      if (fuel.item) referencedItems.add(fuel.item);
      if (fuel.supplement) referencedItems.add(fuel.supplement);
      if (fuel.byproduct) referencedItems.add(fuel.byproduct);
    }
    generators[cls.ClassName] = {
      id: cls.ClassName,
      name: cls.mDisplayName ?? cls.ClassName,
      powerProduction,
      fuels,
    };
  }

  const belts = {};
  for (const cls of classes) {
    if (!/^Build_ConveyorBeltMk\d+_C$/.test(cls.ClassName ?? '')) continue;
    belts[cls.ClassName] = {
      id: cls.ClassName,
      name: cls.mDisplayName ?? cls.ClassName,
      rate: toNumber(cls.mSpeed) / 2,
    };
  }

  const pipes = {};
  for (const cls of classes) {
    if (!/^Build_Pipeline(MK2)?(_NoIndicator)?_C$/.test(cls.ClassName ?? '')) continue;
    pipes[cls.ClassName] = {
      id: cls.ClassName,
      name: cls.mDisplayName ?? cls.ClassName,
      rate: toNumber(cls.mFlowLimit) * 60,
    };
  }

  const items = {};
  for (const id of [...referencedItems].sort()) {
    const cls = byName.get(id);
    if (!cls) continue;
    items[id] = {
      id,
      name: cls.mDisplayName ?? id,
      form: formOf(cls.mForm),
      energyMJ: energyPerDisplayUnit(byName, id),
      stackSize: STACK_SIZES[cls.mStackSize] ?? 1,
      sinkPoints: toNumber(cls.mResourceSinkPoints),
    };
  }

  const dataset = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    gameVersion: GAME_VERSION,
    saveVersionMax: SAVE_VERSION_MAX,
    sourceUrl: SOURCE_URL,
    sourceCommit: SOURCE_COMMIT,
    sourceSha256: sha256,
    attribution:
      'Game data extracted from Satisfactory Docs.json. Satisfactory is a trademark of Coffee Stain Studios. Source repository: aringadre76/satisfactory-api (MIT).',
    items,
    recipes,
    machines,
    extractors,
    generators,
    belts,
    pipes,
  };

  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');

  const size = Buffer.byteLength(JSON.stringify(dataset));
  console.log(
    `Wrote ${outputPath}\n` +
      `  items: ${Object.keys(items).length}, recipes: ${Object.keys(recipes).length}, ` +
      `machines: ${Object.keys(machines).length}, extractors: ${Object.keys(extractors).length}, ` +
      `generators: ${Object.keys(generators).length}, belts: ${Object.keys(belts).length}, ` +
      `pipes: ${Object.keys(pipes).length}\n` +
      `  source sha256: ${sha256}\n  dataset bytes: ${size}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
