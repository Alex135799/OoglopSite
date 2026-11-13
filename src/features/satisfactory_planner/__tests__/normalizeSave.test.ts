// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { SatisfactorySave } from '@etothepii/satisfactory-file-parser';
import { normalizeSave } from '../domain/normalizeSave';
import { gameData } from '../api/gameData';
import { parseSaveBuffer } from '../api/parseSave';
import { analyzeModel } from '../domain/analyzeModel';

const fixtureUrl = new URL('../fixtures/Another-1-2.sav', import.meta.url);

const property = (type: string, value: unknown) => ({ type, value });

const entity = (
  typePath: string,
  instanceName: string,
  properties: Record<string, unknown> = {},
  translation = { x: 10, y: 20, z: 30 },
) => ({
  type: 'SaveEntity',
  typePath,
  instanceName,
  properties,
  transform: { rotation: { x: 0, y: 0, z: 0, w: 1 }, translation, scale3d: { x: 1, y: 1, z: 1 } },
});

const component = (
  typePath: string,
  instanceName: string,
  properties: Record<string, unknown> = {},
) => ({ type: 'SaveComponent', typePath, instanceName, properties });

const makeSave = (objects: unknown[]): SatisfactorySave =>
  ({
    name: 'test.sav',
    header: {
      saveHeaderType: 14,
      saveVersion: 58,
      buildVersion: 123,
      mapName: 'Persistent_Level',
      mapOptions: '',
      sessionName: 'test',
      playDurationSeconds: 1,
      saveDateTime: '',
      sessionVisibility: 0,
      isModdedSave: 0,
    },
    levels: {
      Persistent_Level: {
        name: 'Persistent_Level',
        objects,
        collectables: [],
        writesDestroyedActorsInTOCBlob: false,
      },
    },
  }) as unknown as SatisfactorySave;

const options = {
  fileName: 'test.sav',
  sha256: 'abc',
  size: 42,
  importedAt: '2026-01-01T00:00:00.000Z',
};

describe('normalizeSave', () => {
  it('normalizes the committed 1.2 fixture and keeps the model JSON-safe', async () => {
    const buffer = await readFile(fixtureUrl);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const parsed = parseSaveBuffer({
      fileName: 'Another-1-2.sav',
      buffer: arrayBuffer,
      sha256: 'fixture-hash',
      size: buffer.byteLength,
      importedAt: options.importedAt,
    });

    expect(parsed.gameDataVersion).toBe('1.2');
    expect(parsed.saveGameVersion).toContain('save 58');
    expect(parsed.source.fileName).toBe('Another-1-2.sav');
    expect(parsed.buildings).toHaveLength(1);
    expect(parsed.buildings[0].typeId).toBe('Build_MinerMk2_C');
    expect(parsed.buildings[0].modeled).toBe(true);
    expect(parsed.buildings[0].clock).toBe(1);
    expect(parsed.buildings[0].outputs).toEqual([{ itemId: 'Desc_SAM_C', rate: 240 }]);
    expect(parsed.buildings[0].powerConsumption).toBe(15);
    expect(parsed.counts.belts).toBe(2);
    expect(parsed.counts.pipes).toBe(0);
    expect(parsed.counts.buildables).toBeGreaterThan(0);
    expect(parsed.coverage).toMatchObject({
      totalBuildings: 1,
      modeledBuildings: 1,
      ratio: 1,
    });
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].outputItems).toEqual(['Desc_SAM_C']);
    expect(analyzeModel(parsed).findings.some((finding) => finding.kind === 'power_deficit')).toBe(
      true,
    );
    expect(parsed.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it('applies clock, somersloop boost, power shards and recipe rates', () => {
    const save = makeSave([
      entity('/Game/Buildable/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Build_A', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
        mCurrentPotential: property('FloatProperty', 1.5),
        mCurrentProductionBoost: property('FloatProperty', 2),
        mInventoryPotential: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_A.InventoryPotential',
        }),
      }),
      component('/Script/FactoryGame.FGInventoryComponent', 'Persistent_Level:PersistentLevel.Build_A.InventoryPotential', {
        mInventoryStacks: property('ArrayProperty', undefined),
      }),
    ]);

    // Replace the array property with the shape the parser produces for stacks.
    const inventory = (save.levels.Persistent_Level.objects[1] as unknown as {
      properties: Record<string, unknown>;
    }).properties;
    inventory.mInventoryStacks = {
      type: 'ArrayProperty',
      values: [
        {
          type: 'InventoryStack',
          properties: {
            Item: property('StructProperty', {
              itemReference: {
                pathName: '/Game/Items/Desc_CrystalShard.Desc_CrystalShard_C',
              },
            }),
            NumItems: property('IntProperty', 2),
          },
        },
      ],
    };

    const result = normalizeSave(save, options);
    expect(result.buildings).toHaveLength(1);
    const [machine] = result.buildings;
    expect(machine.clock).toBe(1.5);
    expect(machine.boost).toBe(2);
    expect(machine.shards).toBe(2);
    expect(machine.inputs).toEqual([{ itemId: 'Desc_IronIngot_C', rate: 45 }]);
    expect(machine.outputs).toEqual([{ itemId: 'Desc_IronPlate_C', rate: 60 }]);
    expect(machine.recipeInputs).toEqual([{ itemId: 'Desc_IronIngot_C', amount: 3 }]);
    expect(machine.recipeOutputs).toEqual([{ itemId: 'Desc_IronPlate_C', amount: 2 }]);
    expect(machine.powerConsumption).toBeCloseTo(27.35, 1);
    expect(machine.recipeName).toBe('Iron Plate');
    expect(machine.location).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('models extractors from the resource node, including purity', () => {
    const save = makeSave([
      entity('/Game/Buildable/Build_MinerMk2.Build_MinerMk2_C', 'Build_Miner', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Node',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.Node', {
        mPurityOverride: property('ByteProperty', {
          type: 'EResourcePurity',
          value: 'RP_Impure',
        }),
        mResourceClassOverride: property('ObjectProperty', {
          pathName: '/Game/Items/Desc_IronOre.Desc_IronOre_C',
        }),
      }),
    ]);

    const result = normalizeSave(save, options);
    const [miner] = result.buildings;
    expect(miner.modeled).toBe(true);
    expect(miner.outputs).toEqual([{ itemId: 'Desc_IronOre_C', rate: 60 }]);
    expect(miner.notes).toContain('Resource node purity: 0.5x.');
  });

  it('models generators and counts generation', () => {
    const save = makeSave([
      entity(
        '/Game/Buildable/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C',
        'Build_Coal',
        {},
      ),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].powerGeneration).toBe(75);
    expect(result.buildings[0].fuelUnknown).toBe(true);
    expect(result.power.generation).toBe(75);
    expect(result.power.generators).toBe(1);
  });

  it('models coal generator fuel, water and inventory runtime', () => {
    const save = makeSave([
      entity(
        '/Game/Buildable/GeneratorCoal/Build_GeneratorCoal.Build_GeneratorCoal_C',
        'Build_Coal',
        {
          mFuelInventory: property('ObjectProperty', {
            pathName: 'Persistent_Level:PersistentLevel.Build_Coal.FuelInventory',
          }),
          mCurrentFuelClass: property('ObjectProperty', {
            pathName: '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C',
          }),
        },
      ),
      component(
        '/Script/FactoryGame.FGInventoryComponent',
        'Persistent_Level:PersistentLevel.Build_Coal.FuelInventory',
        {
          mInventoryStacks: {
            type: 'ArrayProperty',
            values: [
              {
                type: 'InventoryStack',
                properties: {
                  Item: property('StructProperty', {
                    itemReference: {
                      pathName: '/Game/FactoryGame/Resource/RawResources/Coal/Desc_Coal.Desc_Coal_C',
                    },
                  }),
                  NumItems: property('IntProperty', 100),
                },
              },
            ],
          },
        },
      ),
    ]);
    const [generator] = normalizeSave(save, options).buildings;
    expect(generator).toMatchObject({
      powerGeneration: 75,
      selectedFuel: 'Desc_Coal_C',
      inputs: [
        { itemId: 'Desc_Coal_C', rate: 15 },
        { itemId: 'Desc_Water_C', rate: 45 },
      ],
      outputs: [],
      fuelBuffer: {
        itemId: 'Desc_Coal_C',
        amount: 100,
        runtimeMinutes: 6.6667,
      },
    });
    expect(generator.notes?.join(' ')).toContain('about 6.6667 min');
  });

  it('models nuclear generator water and waste output', () => {
    const save = makeSave([
      entity(
        '/Game/Buildable/GeneratorNuclear/Build_GeneratorNuclear.Build_GeneratorNuclear_C',
        'Build_Nuclear',
        {
          mFuelInventory: property('ObjectProperty', {
            pathName: 'Persistent_Level:PersistentLevel.Build_Nuclear.FuelInventory',
          }),
        },
      ),
      component(
        '/Script/FactoryGame.FGInventoryComponent',
        'Persistent_Level:PersistentLevel.Build_Nuclear.FuelInventory',
        {
          mInventoryStacks: {
            type: 'ArrayProperty',
            values: [
              {
                type: 'InventoryStack',
                properties: {
                  Item: property('StructProperty', {
                    itemReference: {
                      pathName:
                        '/Game/FactoryGame/Resource/Parts/NuclearFuelRod/Desc_NuclearFuelRod.Desc_NuclearFuelRod_C',
                    },
                  }),
                  NumItems: property('IntProperty', 10),
                },
              },
            ],
          },
        },
      ),
    ]);
    const [generator] = normalizeSave(save, options).buildings;
    expect(generator.inputs).toEqual([
      { itemId: 'Desc_NuclearFuelRod_C', rate: 0.2 },
      { itemId: 'Desc_Water_C', rate: 240 },
    ]);
    expect(generator.outputs).toEqual([{ itemId: 'Desc_NuclearWaste_C', rate: 10 }]);
    expect(generator.selectedFuel).toBe('Desc_NuclearFuelRod_C');
  });

  it('keeps unknown production buildings out of rates and reports them', () => {
    const save = makeSave([
      entity('/Game/Buildable/Mod/Build_ModMachine.Build_ModMachine_C', 'Build_Mod', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_Missing.Recipe_Missing_C',
        }),
      }),
      entity('/Game/Buildable/Mod/Build_ModGenerator.Build_ModGenerator_C', 'Build_Gen', {
        mFuelInventory: property('ObjectProperty', undefined),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings).toHaveLength(2);
    expect(result.coverage).toMatchObject({
      totalBuildings: 2,
      modeledBuildings: 0,
      ratio: 0,
    });
    expect(result.coverage.unmodeledTypes).toEqual([
      { typeId: 'Build_ModGenerator_C', count: 1 },
      { typeId: 'Build_ModMachine_C', count: 1 },
    ]);
    expect(result.power.unmodeledGenerators).toBe(1);
    expect(result.buildings.find((building) => building.id === 'Build_Mod')?.notes?.[0]).toContain(
      'not in the 1.2 dataset',
    );
  });


  it('handles parser edge shapes and additional building categories', () => {
    const rawObjects: unknown[] = [
      entity('/Game/Buildable/Build_Dupe.Build_Dupe_C', 'Build_Dupe', {
        mCurrentRecipe: [
          property('ObjectProperty', {
            pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
          }),
          property('ObjectProperty', {
            pathName: '/Game/Recipes/Recipe_IronRod.Recipe_IronRod_C',
          }),
        ],
        mCurrentPotential: property('FloatProperty', { value: 1.2 }),
        mCurrentProductionBoost: property('FloatProperty', { value: 0.1 }),
        mInventoryPotential: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_Dupe.InventoryPotential',
        }),
      }),
      component(
        '/Script/FactoryGame.FGInventoryComponent',
        'Persistent_Level:PersistentLevel.Build_Dupe.InventoryPotential',
        {
          mInventoryStacks: {
            type: 'ArrayProperty',
            values: [
              { type: 'InventoryStack', properties: { Item: property('StructProperty', 'bad') } },
              {
                type: 'InventoryStack',
                properties: {
                  Item: property('StructProperty', { itemReference: 'bad' }),
                },
              },
              {
                type: 'InventoryStack',
                properties: {
                  Item: property('StructProperty', {
                    itemReference: {
                      pathName: '/Game/Items/Desc_CrystalShard.Desc_CrystalShard_C',
                    },
                  }),
                  NumItems: property('IntProperty', { value: 2 }),
                },
              },
            ],
          },
        },
      ),
      {
        type: 'SaveEntity',
        typePath: '/Game/Buildable/Build_StringRef.Build_StringRef_C',
        instanceName: 'Build_StringRef',
        properties: {
          mCurrentRecipe: property(
            'NameProperty',
            '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
          ),
        },
      },
      entity('/Game/Buildable/WaterPump/Build_WaterPump_C', 'Build_WaterPump', {}),
      entity('/Game/Buildable/Pipeline/Build_Pipeline_C', 'Build_Pipe', {}),
      entity('/Game/Buildable/Build_CustomMachine.Build_CustomMachine_C', 'Build_CustomMachine', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Build_FrackingExtractor.Build_FrackingExtractor_C', 'Build_Fracking', {
        mPowerInfo: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_Fracking.powerInfo',
        }),
      }),
      component('/Script/FactoryGame.FGPowerInfoComponent', 'Persistent_Level:PersistentLevel.Build_Fracking.powerInfo', {
        mTargetConsumption: property('FloatProperty', 5),
      }),
      entity('/Game/Buildable/GeneratorGeoThermal/Build_GeneratorGeoThermal_C', 'Build_Geo', {}),
      entity('/Game/Buildable/Mod/Build_ModPower.Build_ModPower_C', 'Build_ModPower', {
        mFuelInventory: property('ObjectProperty', { pathName: 'None' }),
      }),
      entity('/Game/Buildable/Build_NoneRecipe.Build_NoneRecipe_C', 'Build_NoneRecipe', {
        mCurrentRecipe: property('ObjectProperty', 'None'),
      }),
      entity('/Game/Buildable/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Build_InventoryOnly', {
        mInputInventory: property('ObjectProperty', undefined),
        mOutputInventory: property('ObjectProperty', undefined),
      }),
      entity('/Game/Buildable/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Build_OnlyInput', {
        mInputInventory: property('ObjectProperty', undefined),
      }),
      entity('/Game/Buildable/MinerMK1/Build_MinerMk1.Build_MinerMk1_C', 'Build_NormalNode', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.NodeNormal',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.NodeNormal', {
        mPurityOverride: property('ByteProperty', 'RP_Normal'),
        mResourceClassOverride: property('ObjectProperty', {
          pathName: '/Game/Items/Desc_IronOre.Desc_IronOre_C',
        }),
      }),
      entity('/Game/Buildable/MinerMk2/Build_MinerMk2.Build_MinerMk2_C', 'Build_StringNode', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.NodeString',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.NodeString', {
        mPurityOverride: property('ByteProperty', 'RP_Pure'),
        mResourceClassOverride: property(
          'ObjectProperty',
          '/Game/Items/Desc_IronOre.Desc_IronOre_C',
        ),
      }),
      entity('/Game/Buildable/Decor/BP_Decor.BP_Decor_C', 'BP_Decor', {
        mBuiltWithRecipe: property('ObjectProperty', undefined),
      }),
      {
        type: 'SaveEntity',
        typePath: '',
        instanceName: 'Build_NoType',
        properties: {},
      },
      {
        type: 'SaveEntity',
        typePath: '/',
        instanceName: 'Build_Slash',
        properties: {},
      },
      {
        type: 'SaveEntity',
        typePath: '/Game/Buildable/Build_BadLocation.Build_BadLocation_C',
        instanceName: 'Build_BadLocation',
        properties: {
          mCurrentRecipe: property('ObjectProperty', '/Game/Recipes/Recipe_IronPlate_C'),
        },
        transform: { translation: { x: 'bad', y: 0, z: 0 } },
      },
    ];
    const result = normalizeSave(makeSave(rawObjects), options);
    const byId = new Map(result.buildings.map((building) => [building.id, building]));

    expect(byId.get('Build_Dupe')?.clock).toBe(1.2);
    expect(byId.get('Build_Dupe')?.boost).toBe(0.1);
    expect(byId.get('Build_Dupe')?.shards).toBe(2);
    expect(byId.get('Build_StringRef')?.location).toBeUndefined();
    expect(byId.get('Build_WaterPump')?.outputs).toEqual([
      { itemId: 'Desc_Water_C', rate: 120 },
    ]);
    expect(byId.get('Build_CustomMachine')?.modeled).toBe(true);
    expect(byId.get('Build_CustomMachine')?.notes).toContain(
      'Machine power data is missing; power is treated as unknown.',
    );
    expect(byId.get('Build_Fracking')?.notes).toContain(
      'Could not resolve the extracted resource item.',
    );
    expect(byId.get('Build_Fracking')?.powerConsumption).toBe(5);
    expect(byId.get('Build_Geo')?.notes).toContain(
      'This generator has no fixed power output in the dataset.',
    );
    expect(byId.has('Build_ModPower')).toBe(false);
    expect(byId.get('Build_NoneRecipe')?.modeled).toBe(false);
    expect(byId.get('Build_InventoryOnly')?.modeled).toBe(false);
    expect(byId.get('Build_InventoryOnly')?.knownType).toBe(true);
    expect(byId.get('Build_InventoryOnly')?.notes).toContain(
      'No active recipe is stored for this machine; it is excluded from rates.',
    );
    expect(byId.has('Build_OnlyInput')).toBe(false);
    expect(byId.get('Build_NormalNode')?.outputs).toEqual([
      { itemId: 'Desc_IronOre_C', rate: 60 },
    ]);
    expect(byId.get('Build_BadLocation')?.location).toBeUndefined();
    expect(byId.get('Build_StringNode')?.outputs).toEqual([
      { itemId: 'Desc_IronOre_C', rate: 240 },
    ]);
    expect(result.counts.pipes).toBe(1);
    expect(result.counts.buildables).toBeGreaterThanOrEqual(2);
    expect(result.power.unmodeledGenerators).toBe(1);
  });


  it('does not treat vehicles or drone stations as production buildings', () => {
    const save = makeSave([
      entity('/Game/Buildable/Vehicle/Tractor/BP_Tractor.BP_Tractor_C', 'BP_Tractor', {
        mFuelInventory: property('ObjectProperty', undefined),
      }),
      entity('/Game/Buildable/Factory/DroneStation/Build_DroneStation.Build_DroneStation_C', 'Build_DroneStation', {
        mFuelInventory: property('ObjectProperty', undefined),
        mInputInventory: property('ObjectProperty', undefined),
        mOutputInventory: property('ObjectProperty', undefined),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings).toEqual([]);
  });

  it('leaves a miner unmodeled when its resource node has no resource data', () => {
    const save = makeSave([
      entity('/Game/Buildable/MinerMk2/Build_MinerMk2.Build_MinerMk2_C', 'Build_LegacyMiner', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.LegacyNode',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.LegacyNode', {
        mResourcesLeft: property('IntProperty', -1),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].modeled).toBe(false);
    expect(result.buildings[0].notes).toContain(
      'Could not resolve the extracted resource item.',
    );
  });


  it('infers a legacy extractor resource from its output inventory', () => {
    const save = makeSave([
      entity('/Game/Buildable/MinerMk2/Build_MinerMk2.Build_MinerMk2_C', 'Build_LegacyMiner', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.LegacyNode',
        }),
        mOutputInventory: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_LegacyMiner.OutputInventory',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.LegacyNode', {
        mResourcesLeft: property('IntProperty', -1),
      }),
      component(
        '/Script/FactoryGame.FGInventoryComponent',
        'Persistent_Level:PersistentLevel.Build_LegacyMiner.OutputInventory',
        {
          mInventoryStacks: {
            type: 'ArrayProperty',
            values: [
              {
                type: 'InventoryStack',
                properties: {
                  Item: property('StructProperty', {
                    itemReference: {
                      pathName: '/Game/FactoryGame/Resource/RawResources/OreGold/Desc_OreGold.Desc_OreGold_C',
                    },
                  }),
                  NumItems: property('IntProperty', 100),
                },
              },
            ],
          },
        },
      ),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].modeled).toBe(true);
    expect(result.buildings[0].outputs).toEqual([{ itemId: 'Desc_OreGold_C', rate: 120 }]);
    expect(result.buildings[0].notes).toContain('Resource type inferred from the output inventory.');
    expect(result.buildings[0].notes).toContain('Purity data is missing; assuming normal purity.');
  });


  it('tracks belt and pipe connectivity for unmodeled machines', () => {
    const save = makeSave([
      entity('/Game/Buildable/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.Build_Idle', {
        mInputInventory: property('ObjectProperty', undefined),
        mOutputInventory: property('ObjectProperty', undefined),
      }),
      component(
        '/Script/FactoryGame.FGFactoryConnectionComponent',
        'Persistent_Level:PersistentLevel.Build_Idle.Input0',
        {
          mConnectedComponent: property('ObjectProperty', {
            pathName: 'Persistent_Level:PersistentLevel.ConveyorAny0',
          }),
        },
      ),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].connected).toBe(true);
  });


  it('keeps known but rate-unknown machines out of the unsupported type list', () => {
    const save = makeSave([
      entity('/Game/Buildable/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Build_Idle', {
        mInputInventory: property('ObjectProperty', undefined),
        mOutputInventory: property('ObjectProperty', undefined),
      }),
      entity('/Game/Buildable/MinerMk2/Build_MinerMk2.Build_MinerMk2_C', 'Build_LegacyMiner', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.LegacyNode',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.LegacyNode', {
        mResourcesLeft: property('IntProperty', -1),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.coverage).toMatchObject({
      totalBuildings: 2,
      modeledBuildings: 0,
      ratio: 0,
      unmodeledTypes: [],
    });
  });


  it('infers an unresolved extractor from its nearest connected consumer', () => {
    const save = makeSave([
      entity('/Game/Buildable/MinerMk2/Build_MinerMk2.Build_MinerMk2_C', 'Persistent_Level:PersistentLevel.Build_Miner', {
        mExtractableResource: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.LegacyNode',
        }),
        mOutputInventory: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_Miner.OutputInventory',
        }),
      }),
      entity('/Game/Buildable/SmelterMk1/Build_SmelterMk1.Build_SmelterMk1_C', 'Persistent_Level:PersistentLevel.Build_Smelter', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Smelter/Recipe_IngotIron.Recipe_IngotIron_C',
        }),
      }),
      entity('/Game/Resource/BP_ResourceNode.BP_ResourceNode_C', 'Persistent_Level:PersistentLevel.LegacyNode', {
        mResourcesLeft: property('IntProperty', -1),
      }),
      component(
        '/Script/FactoryGame.FGFactoryConnectionComponent',
        'Persistent_Level:PersistentLevel.Build_Miner.Output0',
        {
          mConnectedComponent: property('ObjectProperty', {
            pathName: 'Persistent_Level:PersistentLevel.Build_Smelter.Input0',
          }),
        },
      ),
      component(
        '/Script/FactoryGame.FGFactoryConnectionComponent',
        'Persistent_Level:PersistentLevel.Build_Smelter.Input0',
        {
          mConnectedComponent: property('ObjectProperty', {
            pathName: 'Persistent_Level:PersistentLevel.Build_Miner.Output0',
          }),
        },
      ),
    ]);
    const result = normalizeSave(save, options);
    const miner = result.buildings.find((building) => building.id.endsWith('Build_Miner'));
    expect(miner?.modeled).toBe(true);
    expect(miner?.outputs).toEqual([{ itemId: 'Desc_OreIron_C', rate: 120 }]);
    expect(miner?.notes).toContain('Resource type inferred from the nearest connected consumer.');
  });


  it('collects actual splitters with their upstream and downstream buildings', () => {
    const save = makeSave([
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.A', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.B', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.C', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConveyorAttachmentSplitter/Build_ConveyorAttachmentSplitter.Build_ConveyorAttachmentSplitter_C', 'Persistent_Level:PersistentLevel.Splitter1', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.A.Output0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.B.Input0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.C.Input0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Splitter1.Input1', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.A.Output0',
        }),
      }),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Splitter1.Output1', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.B.Input0',
        }),
      }),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Splitter1.Output2', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.C.Input0',
        }),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.transportNodes).toEqual([
      {
        id: 'Persistent_Level:PersistentLevel.Splitter1',
        typeId: 'Build_ConveyorAttachmentSplitter_C',
        kind: 'splitter',
        inputs: ['Persistent_Level:PersistentLevel.A'],
        outputs: ['Persistent_Level:PersistentLevel.B', 'Persistent_Level:PersistentLevel.C'],
        directInputs: ['Persistent_Level:PersistentLevel.A'],
        directOutputs: ['Persistent_Level:PersistentLevel.B', 'Persistent_Level:PersistentLevel.C'],
        inputRoles: [{ id: 'Persistent_Level:PersistentLevel.A', role: 'sink' }],
        outputRoles: [
          { id: 'Persistent_Level:PersistentLevel.B', role: 'tap' },
          { id: 'Persistent_Level:PersistentLevel.C', role: 'tap' },
        ],
      },
    ]);
  });


  it('collects actual mergers with their upstream and downstream buildings', () => {
    const save = makeSave([
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.MA', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.MB', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C', 'Persistent_Level:PersistentLevel.MC', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_IronPlate.Recipe_IronPlate_C',
        }),
      }),
      entity('/Game/Buildable/Factory/ConveyorAttachmentMerger/Build_ConveyorAttachmentMerger.Build_ConveyorAttachmentMerger_C', 'Persistent_Level:PersistentLevel.Merger1', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.MA.Output0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.MB.Output0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.MC.Input0', {}),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Merger1.Input1', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.MA.Output0',
        }),
      }),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Merger1.Input2', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.MB.Output0',
        }),
      }),
      component('/Script/FactoryGame.FGFactoryConnectionComponent', 'Persistent_Level:PersistentLevel.Merger1.Output1', {
        mConnectedComponent: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.MC.Input0',
        }),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.transportNodes).toEqual([
      {
        id: 'Persistent_Level:PersistentLevel.Merger1',
        typeId: 'Build_ConveyorAttachmentMerger_C',
        kind: 'merger',
        inputs: ['Persistent_Level:PersistentLevel.MA', 'Persistent_Level:PersistentLevel.MB'],
        outputs: ['Persistent_Level:PersistentLevel.MC'],
        directInputs: ['Persistent_Level:PersistentLevel.MA', 'Persistent_Level:PersistentLevel.MB'],
        directOutputs: ['Persistent_Level:PersistentLevel.MC'],
        inputRoles: [
          { id: 'Persistent_Level:PersistentLevel.MA', role: 'sink' },
          { id: 'Persistent_Level:PersistentLevel.MB', role: 'sink' },
        ],
        outputRoles: [{ id: 'Persistent_Level:PersistentLevel.MC', role: 'tap' }],
      },
    ]);
  });

  it('warns when the save header is newer than the dataset and when modded', () => {
    const save = makeSave([]);
    save.header.saveVersion = 999;
    save.header.isModdedSave = 1;
    const result = normalizeSave(save, options);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('newer than the bundled 1.2 dataset');
    expect(result.warnings[1]).toContain('modded content');
  });

  it('models a no-input fluid recipe from the Converter', () => {
    const save = makeSave([
      entity('/Game/Buildable/Converter/Build_Converter.Build_Converter_C', 'Build_Converter', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_QuantumEnergy.Recipe_QuantumEnergy_C',
        }),
      }),
    ]);
    const result = normalizeSave(save, options);
    const [converter] = result.buildings;
    expect(converter.modeled).toBe(true);
    expect(converter.inputs).toEqual([]);
    expect(converter.outputs).toEqual([{ itemId: 'Desc_QuantumEnergy_C', rate: 200 }]);
    expect(converter.powerConsumption).toBe(400);
  });

  it('uses the maximum estimate for variable-power recipes', () => {
    const save = makeSave([
      entity('/Game/Buildable/QuantumEncoder/Build_QuantumEncoder.Build_QuantumEncoder_C', 'Build_Q', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_SpaceElevatorPart_12.Recipe_SpaceElevatorPart_12_C',
        }),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].powerConsumption).toBe(2000);
    expect(result.buildings[0].notes).toContain(
      'Variable recipe power: using the maximum estimate.',
    );
  });

  it('falls back to the reported power for unmodeled buildings', () => {
    const save = makeSave([
      entity('/Game/Buildable/Mod/Build_ModMachine.Build_ModMachine_C', 'Build_Mod', {
        mCurrentRecipe: property('ObjectProperty', {
          pathName: '/Game/Recipes/Recipe_Missing.Recipe_Missing_C',
        }),
        mPowerInfo: property('ObjectProperty', {
          pathName: 'Persistent_Level:PersistentLevel.Build_Mod.powerInfo',
        }),
      }),
      component('/Script/FactoryGame.FGPowerInfoComponent', 'Persistent_Level:PersistentLevel.Build_Mod.powerInfo', {
        mTargetConsumption: property('FloatProperty', 12.5),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.buildings[0].powerConsumption).toBe(12.5);
    expect(result.power.consumption).toBe(12.5);
  });

  it('handles an empty set of production buildings', () => {
    const result = normalizeSave(makeSave([]), options);
    expect(result.coverage.ratio).toBe(1);
    expect(result.power.headroomRatio).toBe(1);
    expect(result.buildings).toEqual([]);
  });

  it('sorts unmodeled types deterministically', () => {
    const save = makeSave([
      entity('/Game/Buildable/Mod/Build_B.Build_B_C', 'Build_B', {
        mCurrentRecipe: property('ObjectProperty', { pathName: 'Recipe_No.Recipe_No_C' }),
      }),
      entity('/Game/Buildable/Mod/Build_A.Build_A_C', 'Build_A', {
        mCurrentRecipe: property('ObjectProperty', { pathName: 'Recipe_No.Recipe_No_C' }),
      }),
    ]);
    const result = normalizeSave(save, options);
    expect(result.coverage.unmodeledTypes.map((entry) => entry.typeId)).toEqual([
      'Build_A_C',
      'Build_B_C',
    ]);
    expect(gameData.gameVersion).toBe('1.2');
  });
});
