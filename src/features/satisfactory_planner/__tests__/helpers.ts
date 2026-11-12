import type {
  Building,
  ItemRate,
  NormalizedSave,
  ProductionLine,
} from '../domain/types';

export const building = (
  id: string,
  overrides: Partial<Building> = {},
): Building => ({
  id,
  typeId: 'Build_ConstructorMk1_C',
  displayName: 'Constructor',
  clock: 1,
  boost: 0,
  shards: 0,
  inputs: [],
  outputs: [],
  powerConsumption: 0,
  powerGeneration: 0,
  modeled: true,
  physicalGroup: 'test-group',
  ...overrides,
});

export const rates = (entries: Record<string, number>): ItemRate[] =>
  Object.entries(entries).map(([itemId, rate]) => ({ itemId, rate }));

export const model = (
  overrides: Partial<NormalizedSave> = {},
): NormalizedSave => ({
  schemaVersion: 1,
  gameDataVersion: '1.2',
  saveGameVersion: 'save 58 (build 1)',
  importedAt: '2026-01-01T00:00:00.000Z',
  source: {
    fileName: 'test.sav',
    sha256: 'a'.repeat(64),
    size: 1234,
  },
  buildings: [],
  lines: [],
  power: {
    generation: 0,
    consumption: 0,
    headroom: 0,
    headroomRatio: 1,
    generators: 0,
    consumers: 0,
    unmodeledGenerators: 0,
  },
  findings: [],
  coverage: {
    totalBuildings: 0,
    modeledBuildings: 0,
    ratio: 1,
    unmodeledTypes: [],
  },
  counts: {
    entities: 0,
    buildables: 0,
    productionBuildings: 0,
    belts: 0,
    pipes: 0,
  },
  warnings: [],
  ...overrides,
});

export const line = (
  id: string,
  buildingIds: string[],
  overrides: Partial<ProductionLine> = {},
): ProductionLine => ({
  id,
  name: `${id} line`,
  outputItems: [],
  buildingIds,
  flows: [],
  balance: [],
  ...overrides,
});
