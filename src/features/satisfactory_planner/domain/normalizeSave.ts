import type {
  PropertiesMap,
  SatisfactorySave,
  SaveComponent,
  SaveEntity,
  SaveObject,
} from '@etothepii/satisfactory-file-parser';
import type {
  Building,
  ItemRate,
  NormalizedSave,
  SaveCounts,
  SplitterNode,
  TransportRun,
} from '../domain/types';
import { gameData, resolveTypeId, type GameData, type GameRecipe } from '../api/gameData';
import { effectiveMultiplier, estimatedPower, extractorRate, inputMultiplier, perMinute, round } from './rateMath';

interface RawProperty {
  type?: string;
  name?: string;
  value?: unknown;
  values?: unknown[];
}

interface RawStack {
  properties?: PropertiesMap;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const classNameFromPath = (path: string | undefined): string | undefined => {
  if (!path || path === 'None') return undefined;
  const trimmed = path.replace(/'$/, '');
  const last = trimmed.split(/[./]/).filter(Boolean).pop();
  return last?.replace(/'$/, '') || undefined;
};

const asProperty = (value: unknown): RawProperty | undefined => {
  if (Array.isArray(value)) return value[0] as RawProperty | undefined;
  return isRecord(value) ? (value as RawProperty) : undefined;
};

const getProperty = (object: SaveObject, name: string): RawProperty | undefined =>
  asProperty(object.properties?.[name]);

const referenceName = (property: RawProperty | undefined): string | undefined => {
  const value = property?.value;
  if (typeof value === 'string') return value === 'None' ? undefined : value;
  if (isRecord(value) && typeof value.pathName === 'string') {
    return value.pathName === 'None' ? undefined : value.pathName;
  }
  return undefined;
};

const numberOf = (property: RawProperty | undefined, fallback = 0): number => {
  const value = property?.value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value)) {
    return value.value;
  }
  return fallback;
};

const enumOf = (property: RawProperty | undefined): string | undefined => {
  const value = property?.value;
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value.value === 'string') return value.value;
  return undefined;
};

const stacksIn = (inventory: SaveObject | undefined): RawStack[] => {
  if (!inventory) return [];
  const property = getProperty(inventory, 'mInventoryStacks');
  const values = property?.values;
  return Array.isArray(values) ? (values.filter(isRecord) as RawStack[]) : [];
};

const firstItemIn = (inventory: SaveObject | undefined): string | undefined => {
  for (const stack of stacksIn(inventory)) {
    const item = asProperty(stack.properties?.Item);
    const reference = isRecord(item?.value) ? item.value.itemReference : undefined;
    const pathName = isRecord(reference) && typeof reference.pathName === 'string'
      ? reference.pathName
      : undefined;
    const itemId = classNameFromPath(pathName);
    if (itemId) return itemId;
  }
  return undefined;
};

const countItems = (inventory: SaveObject | undefined, itemId: string): number => {
  let count = 0;
  for (const stack of stacksIn(inventory)) {
    const properties = stack.properties;
    const item = asProperty(properties?.Item);
    const reference = isRecord(item?.value) ? item.value.itemReference : undefined;
    const pathName = isRecord(reference) && typeof reference.pathName === 'string'
      ? reference.pathName
      : undefined;
    if (classNameFromPath(pathName) !== itemId) continue;
    count += numberOf(asProperty(properties?.NumItems), 0);
  }
  return count;
};

const allObjects = (save: SatisfactorySave): SaveObject[] =>
  Object.values(save.levels).flatMap((level) => level.objects);

const buildObjectIndex = (objects: SaveObject[]): Map<string, SaveObject> => {
  const index = new Map<string, SaveObject>();
  for (const object of objects) {
    if (object.instanceName) index.set(object.instanceName, object);
  }
  return index;
};

interface PhysicalConnectivity {
  connected: Set<string>;
  neighbors: Map<string, Set<string>>;
  groupFor: (buildingId: string) => string | undefined;
}

const ownerIdOf = (component: SaveObject): string | undefined => {
  const separator = component.instanceName.lastIndexOf('.');
  return separator > 0 ? component.instanceName.slice(0, separator) : undefined;
};

const buildPhysicalConnectivity = (
  objects: SaveObject[],
  index: Map<string, SaveObject>,
): PhysicalConnectivity => {
  const parent = new Map<string, string>();
  const connected = new Set<string>();
  const neighbors = new Map<string, Set<string>>();

  const find = (id: string): string => {
    let current = id;
    for (;;) {
      const next = parent.get(current);
      if (next === undefined || next === current) break;
      current = next;
    }
    return current;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  for (const object of objects) {
    if ((object as SaveComponent).type !== 'SaveComponent') continue;
    if (!/FGFactoryConnectionComponent|FGPipeConnectionFactory/.test(object.typePath)) continue;
    const reference = referenceName(getProperty(object, 'mConnectedComponent'));
    if (!reference) continue;
    const owner = ownerIdOf(object);
    if (!owner) continue;
    if (!parent.has(owner)) parent.set(owner, owner);
    connected.add(owner);
    const peerObject = index.get(reference);
    const peerOwner = peerObject ? ownerIdOf(peerObject) : undefined;
    if (!peerOwner) continue;
    if (!parent.has(peerOwner)) parent.set(peerOwner, peerOwner);
    union(owner, peerOwner);
    connected.add(peerOwner);
    const ownerNeighbors = neighbors.get(owner) ?? new Set<string>();
    ownerNeighbors.add(peerOwner);
    neighbors.set(owner, ownerNeighbors);
    const peerNeighbors = neighbors.get(peerOwner) ?? new Set<string>();
    peerNeighbors.add(owner);
    neighbors.set(peerOwner, peerNeighbors);
  }

  return {
    connected,
    neighbors,
    groupFor: (buildingId) => (connected.has(buildingId) ? find(buildingId) : undefined),
  };
};

const resolveReference = (
  index: Map<string, SaveObject>,
  property: RawProperty | undefined,
): SaveObject | undefined => {
  const name = referenceName(property);
  return name ? index.get(name) : undefined;
};

const locationOf = (object: SaveObject): Building['location'] => {
  const entity = object as SaveEntity;
  const translation = entity.transform?.translation;
  if (!translation) return undefined;
  if (
    typeof translation.x !== 'number' ||
    typeof translation.y !== 'number' ||
    typeof translation.z !== 'number'
  ) {
    return undefined;
  }
  return {
    x: Math.round(translation.x),
    y: Math.round(translation.y),
    z: Math.round(translation.z),
  };
};

const purityMultiplier = (value: string | undefined): number => {
  switch (value) {
    case 'RP_Impure':
      return 0.5;
    case 'RP_Pure':
      return 2;
    case 'RP_Normal':
    default:
      return 1;
  }
};

const isProductionCandidate = (
  object: SaveObject,
  typeId: string,
  data: GameData,
): boolean => {
  if (getProperty(object, 'mCurrentRecipe') !== undefined) return true;
  if (getProperty(object, 'mExtractableResource') !== undefined) return true;
  if (data.generators[typeId] !== undefined) return true;
  if (/Generator/i.test(typeId)) return true;
  if (data.extractors[typeId] !== undefined) return true;
  if (
    data.machines[typeId] !== undefined &&
    getProperty(object, 'mInputInventory') !== undefined &&
    getProperty(object, 'mOutputInventory') !== undefined
  ) {
    return true;
  }
  return false;
};

const recipeRates = (recipe: GameRecipe, multiplier: number): ItemRate[] =>
  recipe.inputs.map((entry) => ({
    itemId: entry.item,
    rate: round(perMinute(entry.amount, recipe.duration) * multiplier),
  }));

const outputRates = (recipe: GameRecipe, multiplier: number): ItemRate[] =>
  recipe.outputs.map((entry) => ({
    itemId: entry.item,
    rate: round(perMinute(entry.amount, recipe.duration) * multiplier),
  }));

const connectionRole = (component: SaveObject): 'in' | 'out' | undefined => {
  const suffix = component.instanceName.split('.').pop() ?? '';
  if (/ConveyorAny0$/.test(suffix)) return 'in';
  if (/ConveyorAny1$/.test(suffix)) return 'out';
  if (/PipeInput/i.test(suffix)) return 'in';
  if (/PipeOutput/i.test(suffix)) return 'out';
  if (/Input/i.test(suffix)) return 'in';
  if (/Output/i.test(suffix)) return 'out';
  return undefined;
};

const collectTransportNodes = (
  objects: SaveObject[],
  buildings: Building[],
  index: Map<string, SaveObject>,
  data: GameData,
): { nodes: SplitterNode[]; runs: TransportRun[] } => {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const transportOwnerIds = new Set(
    objects
      .filter((object) => {
        const typeId = classNameFromPath(object.typePath);
        return Boolean(typeId && /Splitter|Merger|Storage/i.test(typeId));
      })
      .map((object) => object.instanceName),
  );
  const components = objects.filter(
    (object) =>
      (object as SaveComponent).type === 'SaveComponent' &&
      /FGFactoryConnectionComponent|FGPipeConnectionFactory/.test(object.typePath),
  );
  const componentsByOwner = new Map<string, SaveObject[]>();
  for (const component of components) {
    const owner = ownerIdOf(component);
    if (!owner) continue;
    const list = componentsByOwner.get(owner) ?? [];
    list.push(component);
    componentsByOwner.set(owner, list);
  }

  const forward = new Map<string, Set<string>>();
  const reverse = new Map<string, Set<string>>();
  const addEdge = (from: string, to: string) => {
    if (!from || !to) return;
    const out = forward.get(from) ?? new Set<string>();
    out.add(to);
    forward.set(from, out);
    const incoming = reverse.get(to) ?? new Set<string>();
    incoming.add(from);
    reverse.set(to, incoming);
  };

  for (const component of components) {
    const reference = referenceName(getProperty(component, 'mConnectedComponent'));
    if (!reference) continue;
    const peer = index.get(reference);
    if (!peer) continue;
    const role = connectionRole(component);
    if (role === 'out') addEdge(component.instanceName, peer.instanceName);
    else if (role === 'in') addEdge(peer.instanceName, component.instanceName);
  }

  for (const ownerComponents of componentsByOwner.values()) {
    const inputs = ownerComponents.filter((component) => connectionRole(component) === 'in');
    const outputs = ownerComponents.filter((component) => connectionRole(component) === 'out');
    for (const input of inputs) {
      for (const output of outputs) {
        addEdge(input.instanceName, output.instanceName);
      }
    }
  }

  const traverse = (
    start: string,
    direction: 'forward' | 'reverse',
    stopAtTransport: boolean,
  ): Set<string> => {
    const found = new Set<string>();
    const seen = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const nextComponents = (direction === 'forward' ? forward : reverse).get(current);
      for (const next of nextComponents ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const object = index.get(next);
        if (!object) continue;
        const owner = ownerIdOf(object);
        if (!owner) continue;
        if (byId.has(owner) || (stopAtTransport && transportOwnerIds.has(owner))) {
          found.add(owner);
          continue;
        }
        queue.push(next);
      }
    }
    return found;
  };

  const nodes: SplitterNode[] = [];
  for (const object of objects) {
    const typeId = classNameFromPath(object.typePath);
    if (!typeId || !/Splitter|Merger|Storage/i.test(typeId)) continue;
    const transportComponents = componentsByOwner.get(object.instanceName) ?? [];
    const inputComponents = transportComponents.filter(
      (component) => connectionRole(component) === 'in',
    );
    const outputComponents = transportComponents.filter(
      (component) => connectionRole(component) === 'out',
    );
    if (inputComponents.length === 0 || outputComponents.length === 0) continue;

    const inputs = new Set<string>();
    const directInputs = new Set<string>();
    for (const component of inputComponents) {
      for (const id of traverse(component.instanceName, 'reverse', false)) inputs.add(id);
      for (const id of traverse(component.instanceName, 'reverse', true)) directInputs.add(id);
    }
    const outputs = new Set<string>();
    const directOutputs = new Set<string>();
    for (const component of outputComponents) {
      for (const id of traverse(component.instanceName, 'forward', false)) outputs.add(id);
      for (const id of traverse(component.instanceName, 'forward', true)) directOutputs.add(id);
    }
    for (const id of inputs) outputs.delete(id);
    for (const id of directInputs) directOutputs.delete(id);
    if (inputs.size === 0 || outputs.size === 0) continue;
    if (directInputs.size === 0 || directOutputs.size === 0) continue;

    const storage = index.get(`${object.instanceName}.StorageInventory`);
    const itemId = firstItemIn(storage);
    const directInputList = [...directInputs].sort();
    const directOutputList = [...directOutputs].sort();
    nodes.push({
      id: object.instanceName,
      typeId,
      kind: /Merger/i.test(typeId) ? 'merger' : /Storage/i.test(typeId) ? 'storage' : 'splitter',
      ...(itemId ? { itemId } : {}),
      inputs: [...inputs].sort(),
      outputs: [...outputs].sort(),
      directInputs: directInputList,
      directOutputs: directOutputList,
      inputRoles: directInputList.map((id) => ({
        id,
        role: transportOwnerIds.has(id) ? 'continuation' : 'sink',
      })),
      outputRoles: directOutputList.map((id) => ({
        id,
        role: transportOwnerIds.has(id) ? 'continuation' : 'tap',
      })),
    });
  }

  const runMap = new Map<string, TransportRun>();
  const isEndpointOwner = (owner: string) =>
    byId.has(owner) || transportOwnerIds.has(owner);
  for (const startOwner of new Set([
    ...buildings.map((building) => building.id),
    ...transportOwnerIds,
  ])) {
    const ownerComponents = componentsByOwner.get(startOwner) ?? [];
    for (const component of ownerComponents) {
      if (connectionRole(component) !== 'out') continue;
      const queue: { component: string; segments: string[] }[] = [
        { component: component.instanceName, segments: [] },
      ];
      const seen = new Set<string>([component.instanceName]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of forward.get(current.component) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          const object = index.get(next);
          if (!object) continue;
          const owner = ownerIdOf(object);
          if (!owner || owner === startOwner) continue;
          if (isEndpointOwner(owner)) {
            if (current.segments.length === 0) continue;
            const segmentIds = current.segments;
            const key = `${startOwner}\u0000${owner}\u0000${segmentIds.join('\u0000')}`;
            if (runMap.has(key)) continue;
            const segmentTypes = segmentIds.map((id) =>
              classNameFromPath(index.get(id)?.typePath),
            );
            const capacities = segmentTypes.map((typeId) => {
              if (!typeId) return undefined;
              const lift = /Build_ConveyorLiftMk(\d+)_C$/.exec(typeId);
              return (
                data.belts[typeId]?.rate ??
                data.pipes[typeId]?.rate ??
                (lift
                  ? data.belts[`Build_ConveyorBeltMk${lift[1]}_C`]?.rate
                  : undefined)
              );
            });
            const capacity = capacities.every((value) => value !== undefined)
              ? Math.min(...capacities as number[])
              : undefined;
            const medium = segmentTypes.some(
              (typeId) => typeId && data.pipes[typeId] !== undefined,
            )
              ? 'pipe'
              : 'belt';
            runMap.set(key, {
              id: `run:${startOwner}->${owner}:${segmentIds.length}`,
              medium,
              typeId: segmentTypes.find(Boolean) ?? 'belt',
              fromNodeId: startOwner,
              toNodeId: owner,
              ...(capacity !== undefined ? { capacity } : {}),
              segmentCount: segmentIds.length,
              segmentIds,
            });
            continue;
          }
          queue.push({ component: next, segments: [...current.segments, owner] });
        }
      }
    }
  }

  return { nodes, runs: [...runMap.values()] };
};

const inferExtractorResources = (
  buildings: Building[],
  data: GameData,
  connectivity: PhysicalConnectivity,
): void => {
  const byId = new Map(buildings.map((building) => [building.id, building]));

  for (const building of buildings) {
    if (building.modeled) continue;
    const extractor = data.extractors[building.typeId];
    if (!extractor) continue;

    const queue = [building.id];
    const seen = new Set(queue);
    let inferred: string | undefined;

    while (queue.length > 0 && !inferred) {
      const owner = queue.shift()!;
      for (const next of connectivity.neighbors.get(owner) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const candidate = byId.get(next);
        if (candidate?.modeled && candidate.inputs.length === 1) {
          inferred = candidate.inputs[0].itemId;
          break;
        }
        queue.push(next);
      }
    }

    if (!inferred) continue;

    building.inputs = [];
    building.outputs = [
      {
        itemId: inferred,
        rate: round(extractorRate(extractor.baseRate, 1, building.clock)),
      },
    ];
    building.powerConsumption = round(
      estimatedPower(extractor.basePower, building.clock, extractor.powerExponent),
    );
    building.modeled = true;
    building.notes = [
      ...(building.notes ?? []).filter(
        (note) => note !== 'Could not resolve the extracted resource item.',
      ),
      'Resource type inferred from the nearest connected consumer.',
      'Purity data is missing; assuming normal purity.',
    ];
  }
};

export interface NormalizeOptions {
  fileName: string;
  sha256: string;
  size: number;
  importedAt?: string;
  data?: GameData;
}

export const normalizeSave = (
  save: SatisfactorySave,
  options: NormalizeOptions,
): NormalizedSave => {
  const data = options.data ?? gameData;
  const objects = allObjects(save);
  const index = buildObjectIndex(objects);
  const physicalConnectivity = buildPhysicalConnectivity(objects, index);
  const buildings: Building[] = [];
  const warnings: string[] = [];

  if (save.header.saveVersion > data.saveVersionMax) {
    warnings.push(
      `This save uses header version ${save.header.saveVersion}, newer than the bundled ${data.gameVersion} dataset (max ${data.saveVersionMax}). New content may be unmodeled.`,
    );
  }
  if (save.header.isModdedSave) {
    warnings.push('The save reports modded content. Modded buildings are kept but may not be modeled.');
  }

  let buildables = 0;
  let beltCount = 0;
  let pipeCount = 0;

  for (const object of objects) {
    const rawTypeId = classNameFromPath(object.typePath);
    if (!rawTypeId) continue;
    const typeId = resolveTypeId(rawTypeId);
    if (
      object.typePath.includes('/Buildable/') ||
      rawTypeId.startsWith('Build_') ||
      getProperty(object, 'mBuiltWithRecipe') !== undefined
    ) {
      buildables += 1;
    }
    if (data.belts[rawTypeId]) beltCount += 1;
    if (data.pipes[rawTypeId]) pipeCount += 1;

    if ((object as SaveEntity).type !== 'SaveEntity') continue;
    if (!isProductionCandidate(object, typeId, data)) continue;

    const recipeProperty = getProperty(object, 'mCurrentRecipe');
    const recipeRef = referenceName(recipeProperty);
    const recipeId = classNameFromPath(recipeRef);
    const recipe = recipeId ? data.recipes[recipeId] : undefined;
    const machine = data.machines[typeId];
    const extractor = data.extractors[typeId];
    const generator = data.generators[typeId];
    const extractorNode = resolveReference(index, getProperty(object, 'mExtractableResource'));
    const powerInfo = resolveReference(index, getProperty(object, 'mPowerInfo'));
    const reportedPower = numberOf(getProperty(powerInfo ?? object, 'mTargetConsumption'), 0);
    const clock = Math.max(
      0.01,
      numberOf(getProperty(object, 'mCurrentPotential'), 0) ||
        numberOf(getProperty(object, 'mPendingPotential'), 0) ||
        1,
    );
    const boost = Math.max(0, numberOf(getProperty(object, 'mCurrentProductionBoost'), 0));
    const potentialInventory = resolveReference(index, getProperty(object, 'mInventoryPotential'));
    const outputInventory = resolveReference(index, getProperty(object, 'mOutputInventory'));
    const shards = countItems(potentialInventory, 'Desc_CrystalShard_C');

    const notes: string[] = [];
    let displayName = typeId;
    let modeled = false;
    let powerConsumption = 0;
    let powerGeneration = 0;
    let inputs: ItemRate[] = [];
    let outputs: ItemRate[] = [];

    if (generator) {
      displayName = generator.name;
      if (generator.powerProduction > 0) {
        powerGeneration = round(generator.powerProduction * clock);
        modeled = true;
      } else {
        notes.push('This generator has no fixed power output in the dataset.');
      }
    } else if (extractor) {
      displayName = extractor.name;
      const purityValue = enumOf(
        getProperty(extractorNode ?? object, 'mPurityOverride'),
      );
      const purity = purityMultiplier(purityValue);
      const nodeItem = classNameFromPath(
        referenceName(getProperty(extractorNode ?? object, 'mResourceClassOverride')),
      );
      const inventoryItem = firstItemIn(outputInventory);
      const outputItem =
        nodeItem ??
        inventoryItem ??
        (extractor.allowedResources.length === 1 ? extractor.allowedResources[0] : undefined);
      if (outputItem) {
        outputs = [
          {
            itemId: outputItem,
            rate: round(extractorRate(extractor.baseRate, purity, clock)),
          },
        ];
        powerConsumption = round(estimatedPower(extractor.basePower, clock, extractor.powerExponent));
        modeled = true;
        if (!nodeItem && inventoryItem) {
          notes.push('Resource type inferred from the output inventory.');
        }
        if (extractorNode && !purityValue) {
          notes.push('Purity data is missing; assuming normal purity.');
        }
        if (purity !== 1) notes.push(`Resource node purity: ${purity}x.`);
      } else {
        notes.push('Could not resolve the extracted resource item.');
      }
    } else if (recipe) {
      inputs = recipeRates(recipe, inputMultiplier(clock));
      outputs = outputRates(recipe, effectiveMultiplier(clock, boost));
      displayName = machine?.name ?? recipe.name;
      const variablePower =
        machine &&
        machine.basePower <= 0.1 &&
        recipe.variablePower &&
        (recipe.variablePower.constant > 0 || recipe.variablePower.factor > 1)
          ? recipe.variablePower.constant + recipe.variablePower.factor
          : undefined;
      const basePower = variablePower ?? machine?.basePower ?? 0;
      const exponent = machine?.powerExponent ?? 1;
      const boostExponent = machine?.boostPowerExponent ?? 2;
      powerConsumption = round(
        estimatedPower(basePower, clock, exponent, boost, boostExponent),
      );
      modeled = true;
      if (variablePower !== undefined) {
        notes.push('Variable recipe power: using the maximum estimate.');
      }
      if (!machine) {
        notes.push('Machine power data is missing; power is treated as unknown.');
      }
    } else {
      displayName = machine?.name ?? typeId;
      powerConsumption = round(reportedPower);
      if (recipeId) {
        notes.push(`Recipe ${recipeId} is not in the ${data.gameVersion} dataset.`);
      } else if (machine) {
        notes.push('No active recipe is stored for this machine; it is excluded from rates.');
      } else {
        notes.push(`Building type ${rawTypeId} is not modeled.`);
      }
    }

    if (!modeled && powerConsumption === 0 && reportedPower > 0) {
      powerConsumption = round(reportedPower);
    }
    if (!modeled && !generator) {
      inputs = [{ itemId: 'unknown', rate: 0 }];
      outputs = [{ itemId: 'unknown', rate: 0 }];
    }

    const location = locationOf(object);
    const physicalGroup = physicalConnectivity.groupFor(object.instanceName);
    buildings.push({
      id: object.instanceName,
      typeId,
      displayName,
      ...(recipeId ? { recipeId } : {}),
      ...(recipe && recipe.id ? { recipeName: recipe.name } : {}),
      ...(recipe
        ? {
            recipeInputs: recipe.inputs.map((entry) => ({
              itemId: entry.item,
              amount: entry.amount,
            })),
            recipeOutputs: recipe.outputs.map((entry) => ({
              itemId: entry.item,
              amount: entry.amount,
            })),
          }
        : {}),
      clock: round(clock, 3),
      boost: round(boost, 3),
      shards,
      inputs,
      outputs,
      powerConsumption,
      powerGeneration,
      modeled,
      ...(machine || extractor || generator ? { knownType: true } : {}),
      ...(physicalConnectivity.connected.has(object.instanceName) ? { connected: true } : {}),
      ...(physicalGroup ? { physicalGroup } : {}),
      ...(location ? { location } : {}),
      ...(notes.length ? { notes } : {}),
    });
  }

  inferExtractorResources(buildings, data, physicalConnectivity);

  buildings.sort((a, b) => a.id.localeCompare(b.id));
  const transportData = collectTransportNodes(objects, buildings, index, data);
  const transportNodes = transportData.nodes;

  const modeled = buildings.filter((building) => building.modeled);
  const generatorCount = buildings.filter((building) => building.powerGeneration > 0).length;
  const consumerCount = buildings.filter((building) => building.powerConsumption > 0).length;
  const unmodeledGenerators = buildings.filter(
    (building) => !building.modeled && building.powerGeneration === 0 && /Generator/i.test(building.typeId),
  ).length;
  const generation = round(
    buildings.reduce((total, building) => total + building.powerGeneration, 0),
  );
  const consumption = round(
    buildings.reduce((total, building) => total + building.powerConsumption, 0),
  );
  const headroom = round(generation - consumption);
  const headroomRatio =
    generation > 0 ? headroom / generation : consumption === 0 ? 1 : 0;

  const counts: SaveCounts = {
    entities: objects.length,
    buildables,
    productionBuildings: buildings.length,
    belts: beltCount,
    pipes: pipeCount,
  };

  const unmodeledByType = new Map<string, number>();
  for (const building of buildings) {
    if (building.modeled) continue;
    const knownType =
      data.machines[building.typeId] !== undefined ||
      data.extractors[building.typeId] !== undefined ||
      data.generators[building.typeId] !== undefined;
    if (knownType) continue;
    unmodeledByType.set(building.typeId, (unmodeledByType.get(building.typeId) ?? 0) + 1);
  }

  return {
    schemaVersion: 1,
    gameDataVersion: data.gameVersion,
    saveGameVersion: `save ${save.header.saveVersion} (build ${save.header.buildVersion})`,
    importedAt: options.importedAt ?? new Date().toISOString(),
    source: {
      fileName: options.fileName,
      sha256: options.sha256,
      size: options.size,
    },
    buildings,
    transportNodes,
    transportRuns: transportData.runs,
    lines: [],
    power: {
      generation,
      consumption,
      headroom,
      headroomRatio: round(headroomRatio, 4),
      generators: generatorCount,
      consumers: consumerCount,
      unmodeledGenerators,
    },
    findings: [],
    coverage: {
      totalBuildings: buildings.length,
      modeledBuildings: modeled.length,
      ratio: buildings.length === 0 ? 1 : round(modeled.length / buildings.length, 4),
      unmodeledTypes: [...unmodeledByType.entries()]
        .map(([typeId, count]) => ({ typeId, count }))
        .sort((a, b) => b.count - a.count || a.typeId.localeCompare(b.typeId)),
    },
    counts,
    warnings,
  };
};
