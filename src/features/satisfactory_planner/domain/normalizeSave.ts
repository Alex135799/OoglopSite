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

const itemCountsIn = (inventory: SaveObject | undefined): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const stack of stacksIn(inventory)) {
    const properties = stack.properties;
    const item = asProperty(properties?.Item);
    const reference = isRecord(item?.value) ? item.value.itemReference : undefined;
    const pathName =
      isRecord(reference) && typeof reference.pathName === 'string'
        ? reference.pathName
        : undefined;
    const itemId = classNameFromPath(pathName);
    if (!itemId) continue;
    counts.set(itemId, (counts.get(itemId) ?? 0) + numberOf(asProperty(properties?.NumItems), 0));
  }
  return counts;
};

const storageContents = (inventory: SaveObject | undefined): Array<{ itemId: string; amount: number }> => {
  const stacks: Array<{ itemId: string; amount: number }> = [];
  for (const stack of stacksIn(inventory)) {
    const properties = stack.properties;
    const item = asProperty(properties?.Item);
    const reference = isRecord(item?.value) ? item.value.itemReference : undefined;
    const pathName =
      isRecord(reference) && typeof reference.pathName === 'string'
        ? reference.pathName
        : undefined;
    const itemId = classNameFromPath(pathName);
    const amount = numberOf(asProperty(properties?.NumItems), 0);
    if (itemId && amount > 0) stacks.push({ itemId, amount });
  }
  return stacks;
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

const collectPipeNetworks = (
  objects: SaveObject[],
  buildings: Building[],
  index: Map<string, SaveObject>,
  data: GameData,
): { nodes: SplitterNode[]; runs: TransportRun[] } => {
  const byId = new Map(buildings.map((building) => [building.id, building]));
  const pipeComponents = objects.filter(
    (object) =>
      (object as SaveComponent).type === 'SaveComponent' &&
      /FGPipeConnectionFactory$|FGPipeConnectionComponent$/.test(object.typePath ?? ''),
  );
  if (pipeComponents.length === 0) return { nodes: [], runs: [] };
  const pipeIds = new Set(pipeComponents.map((component) => component.instanceName));
  const networkIdOf = (component: SaveObject): number =>
    numberOf(getProperty(component, 'mPipeNetworkID'), -1);
  const adjacency = new Map<string, Set<string>>();
  const addAdjacency = (a: string, b: string) => {
    if (!pipeIds.has(a) || !pipeIds.has(b)) return;
    const forward = adjacency.get(a) ?? new Set<string>();
    forward.add(b);
    adjacency.set(a, forward);
    const reverse = adjacency.get(b) ?? new Set<string>();
    reverse.add(a);
    adjacency.set(b, reverse);
  };

  for (const component of pipeComponents) {
    const peer = referenceName(getProperty(component, 'mConnectedComponent'));
    if (peer) addAdjacency(component.instanceName, peer);
  }

  const componentsByOwner = new Map<string, SaveObject[]>();
  for (const component of pipeComponents) {
    const owner = ownerIdOf(component);
    if (!owner) continue;
    const list = componentsByOwner.get(owner) ?? [];
    list.push(component);
    componentsByOwner.set(owner, list);
  }
  for (const [owner, ownerComponents] of componentsByOwner) {
    const ownerTypeId = classNameFromPath(index.get(owner)?.typePath);
    if (!ownerTypeId || byId.has(owner) || !/Pipeline|Tank/i.test(ownerTypeId)) continue;
    for (let left = 0; left < ownerComponents.length; left += 1) {
      for (let right = left + 1; right < ownerComponents.length; right += 1) {
        addAdjacency(ownerComponents[left].instanceName, ownerComponents[right].instanceName);
      }
    }
  }

  interface PipeEndpoint {
    componentId: string;
    ownerId: string;
    role: 'in' | 'out';
    itemId?: string;
  }

  const endpointByComponent = new Map<string, PipeEndpoint>();
  const factoryComponentsByOwner = new Map<string, SaveObject[]>();
  for (const component of pipeComponents) {
    if (!/FGPipeConnectionFactory$/.test(component.typePath ?? '')) continue;
    const owner = ownerIdOf(component);
    if (!owner) continue;
    const list = factoryComponentsByOwner.get(owner) ?? [];
    list.push(component);
    factoryComponentsByOwner.set(owner, list);
  }

  const isFluidItem = (itemId: string) => {
    const form = data.items[itemId]?.form;
    return form === 'liquid' || form === 'gas';
  };

  for (const building of buildings) {
    const factories = (factoryComponentsByOwner.get(building.id) ?? []).sort((a, b) =>
      a.instanceName.localeCompare(b.instanceName),
    );
    if (factories.length === 0) continue;
    const fluidInputs = building.inputs.filter((entry) => isFluidItem(entry.itemId));
    const fluidOutputs = building.outputs.filter((entry) => isFluidItem(entry.itemId));
    const ports = [
      ...fluidInputs.map((entry) => ({ role: 'in' as const, itemId: entry.itemId })),
      ...fluidOutputs.map((entry) => ({ role: 'out' as const, itemId: entry.itemId })),
    ];
    if (ports.length === 0) continue;
    if (fluidInputs.length === 0 || fluidOutputs.length === 0) {
      const role = fluidInputs.length > 0 ? 'in' : 'out';
      const itemId = ports[0]?.itemId;
      for (const component of factories) {
        endpointByComponent.set(component.instanceName, {
          componentId: component.instanceName,
          ownerId: building.id,
          role,
          ...(itemId ? { itemId } : {}),
        });
      }
      continue;
    }
    if (factories.length !== ports.length) continue;
    factories.forEach((component, index) => {
      const port = ports[index];
      if (!port) return;
      endpointByComponent.set(component.instanceName, {
        componentId: component.instanceName,
        ownerId: building.id,
        role: port.role,
        itemId: port.itemId,
      });
    });
  }

  const junctionOwners = new Set<string>();
  const tankOwners = new Set<string>();
  for (const [owner] of componentsByOwner) {
    const ownerType = classNameFromPath(index.get(owner)?.typePath) ?? '';
    if (/PipelineJunction/i.test(ownerType)) junctionOwners.add(owner);
    if (/PipeStorageTank|IndustrialTank/i.test(ownerType)) tankOwners.add(owner);
  }

  interface PipeNode {
    id: string;
    kind: 'endpoint' | 'junction' | 'tank';
    ownerId: string;
    role?: 'in' | 'out';
    itemId?: string;
    typeId?: string;
    storedAmount?: number;
  }

  const nodeById = new Map<string, PipeNode>();
  const nodeForComponent = new Map<string, string>();
  const nodePorts = new Map<string, string[]>();

  for (const endpoint of endpointByComponent.values()) {
    const nodeId = `pipe-endpoint:${endpoint.componentId}`;
    nodeById.set(nodeId, {
      id: nodeId,
      kind: 'endpoint',
      ownerId: endpoint.ownerId,
      role: endpoint.role,
      ...(endpoint.itemId ? { itemId: endpoint.itemId } : {}),
    });
    nodeForComponent.set(endpoint.componentId, nodeId);
    nodePorts.set(nodeId, [endpoint.componentId]);
  }

  for (const owner of junctionOwners) {
    const nodeId = `pipe-junction:${owner}`;
    const components = componentsByOwner.get(owner) ?? [];
    nodeById.set(nodeId, {
      id: nodeId,
      kind: 'junction',
      ownerId: owner,
      typeId: classNameFromPath(index.get(owner)?.typePath),
    });
    nodePorts.set(nodeId, components.map((component) => component.instanceName));
    for (const component of components) nodeForComponent.set(component.instanceName, nodeId);
  }

  for (const owner of tankOwners) {
    const nodeId = `pipe-tank:${owner}`;
    const components = componentsByOwner.get(owner) ?? [];
    const ownerObject = index.get(owner);
    const fluidBox = ownerObject ? getProperty(ownerObject, 'mFluidBox') : undefined;
    const fluidValue = isRecord(fluidBox?.value) ? fluidBox.value : undefined;
    const storedAmount =
      isRecord(fluidValue) && typeof fluidValue.value === 'number' ? fluidValue.value : 0;
    nodeById.set(nodeId, {
      id: nodeId,
      kind: 'tank',
      ownerId: owner,
      typeId: classNameFromPath(ownerObject?.typePath),
      storedAmount,
    });
    nodePorts.set(nodeId, components.map((component) => component.instanceName));
    for (const component of components) nodeForComponent.set(component.instanceName, nodeId);
  }

  interface RawPipeEdge {
    a: string;
    b: string;
    segments: string[];
    networkId: number;
  }

  const edgeMap = new Map<string, RawPipeEdge>();
  for (const nodeId of nodePorts.keys()) {
    for (const startComponent of nodePorts.get(nodeId) ?? []) {
      const startObject = index.get(startComponent);
      if (!startObject) continue;
      const startNetwork = networkIdOf(startObject);
      const queue: Array<{ id: string; segments: string[] }> = [
        { id: startComponent, segments: [] },
      ];
      const seen = new Set<string>([startComponent]);
      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const next of adjacency.get(current.id) ?? []) {
          if (seen.has(next)) continue;
          seen.add(next);
          const nextObject = index.get(next);
          if (!nextObject || networkIdOf(nextObject) !== startNetwork) continue;
          const nextOwner = nextObject ? ownerIdOf(nextObject) : undefined;
          if (!nextOwner) continue;
          const nextNode = nodeForComponent.get(next);
          if (nextNode && nextNode !== nodeId) {
            const key = [nodeId, nextNode].sort().join('\0') + '\0' + [...current.segments].sort().join('|');
            if (!edgeMap.has(key)) {
              edgeMap.set(key, {
                a: nodeId,
                b: nextNode,
                segments: [...current.segments],
                networkId: startNetwork,
              });
            }
            continue;
          }
          if (nextOwner === nodeId || nodeForComponent.has(next)) continue;
          if (byId.has(nextOwner) || junctionOwners.has(nextOwner)) continue;
          const nextTypeId = classNameFromPath(index.get(nextOwner)?.typePath);
          if (!nextTypeId || !/Pipeline/i.test(nextTypeId)) continue;
          const segments = current.segments[current.segments.length - 1] === nextOwner
            ? current.segments
            : [...current.segments, nextOwner];
          queue.push({ id: next, segments });
        }
      }
    }
  }

  const edgeAdjacency = new Map<string, Set<string>>();
  const addEdgeAdjacency = (a: string, b: string) => {
    const forward = edgeAdjacency.get(a) ?? new Set<string>();
    forward.add(b);
    edgeAdjacency.set(a, forward);
    const reverse = edgeAdjacency.get(b) ?? new Set<string>();
    reverse.add(a);
    edgeAdjacency.set(b, reverse);
  };
  for (const edge of edgeMap.values()) addEdgeAdjacency(edge.a, edge.b);

  const networkNodes = new Map<number, Set<string>>();
  for (const edge of edgeMap.values()) {
    const nodesForNetwork = networkNodes.get(edge.networkId) ?? new Set<string>();
    nodesForNetwork.add(edge.a);
    nodesForNetwork.add(edge.b);
    networkNodes.set(edge.networkId, nodesForNetwork);
  }
  const networkIds = [...networkNodes.keys()];
  const networks: string[][] = networkIds.map((networkId) =>
    [...(networkNodes.get(networkId) ?? [])],
  );
  const networkForNode = new Map<string, number>();
  networks.forEach((network, index) => {
    for (const nodeId of network) networkForNode.set(nodeId, index);
  });

  const runs: TransportRun[] = [];
  const runKeys = new Set<string>();
  for (let networkIndex = 0; networkIndex < networks.length; networkIndex += 1) {
    const network = networks[networkIndex];
    const items = new Set<string>();
    for (const nodeId of network) {
      const itemId = nodeById.get(nodeId)?.itemId;
      if (itemId) items.add(itemId);
    }
    const networkItem = items.size === 1 ? [...items][0] : undefined;
    const endpointProducers = network.filter((nodeId) => nodeById.get(nodeId)?.role === 'out');
    const tankProducers = network.filter(
      (nodeId) => nodeById.get(nodeId)?.kind === 'tank' && (nodeById.get(nodeId)?.storedAmount ?? 0) > 0,
    );
    const producers = endpointProducers.length > 0 ? endpointProducers : tankProducers;
    const distances = new Map<string, number>();
    const queue = [...producers];
    for (const producer of producers) distances.set(producer, 0);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const distance = distances.get(current) ?? 0;
      for (const next of edgeAdjacency.get(current) ?? []) {
        if (distances.has(next)) continue;
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }

    for (const edge of edgeMap.values()) {
      if (
        networkForNode.get(edge.a) !== networkIndex ||
        networkForNode.get(edge.b) !== networkIndex
      ) {
        continue;
      }
      const nodeA = nodeById.get(edge.a);
      const nodeB = nodeById.get(edge.b);
      if (!nodeA || !nodeB || nodeA.ownerId === nodeB.ownerId) continue;
      const da = distances.get(edge.a);
      const db = distances.get(edge.b);
      const known = da !== undefined && db !== undefined && da !== db && Boolean(networkItem);
      const fromNode = known && (da as number) < (db as number) ? nodeA : nodeB;
      const toNode = known && (da as number) < (db as number) ? nodeB : nodeA;
      const segmentTypes = edge.segments.map((id) => classNameFromPath(index.get(id)?.typePath));
      const capacities = segmentTypes.map((typeId) => (typeId ? data.pipes[typeId]?.rate : undefined));
      const capacity =
        capacities.length > 0 && capacities.every((value) => value !== undefined)
          ? Math.min(...(capacities as number[]))
          : undefined;
      const runKey = `${fromNode.ownerId}\0${toNode.ownerId}\0${edge.segments.join('|')}`;
      if (runKeys.has(runKey)) continue;
      runKeys.add(runKey);
      runs.push({
        id: `pipe:${fromNode.ownerId}->${toNode.ownerId}:${edge.segments.length}`,
        medium: 'pipe',
        typeId: segmentTypes.find(Boolean) ?? 'Build_Pipeline_C',
        fromNodeId: fromNode.ownerId,
        toNodeId: toNode.ownerId,
        ...(networkItem ? { itemId: networkItem } : {}),
        ...(capacity !== undefined ? { capacity } : {}),
        unknown: !known || capacity === undefined,
        segmentCount: edge.segments.length,
        segmentIds: edge.segments,
      });
    }
  }

  const nodes: SplitterNode[] = [];
  for (const junctionOwner of junctionOwners) {
    const junctionNodeId = `pipe-junction:${junctionOwner}`;
    const networkIndex = networkForNode.get(junctionNodeId);
    if (networkIndex === undefined) continue;
    const network = networks[networkIndex] ?? [];
    const items = new Set<string>();
    for (const nodeId of network) {
      const itemId = nodeById.get(nodeId)?.itemId;
      if (itemId) items.add(itemId);
    }
    const itemId = items.size === 1 ? [...items][0] : undefined;
    const incoming = [...new Set(
      runs.filter((run) => run.toNodeId === junctionOwner).map((run) => run.fromNodeId),
    )];
    const outgoing = [...new Set(
      runs.filter((run) => run.fromNodeId === junctionOwner).map((run) => run.toNodeId),
    )];
    if (incoming.length === 0 && outgoing.length === 0) continue;
    nodes.push({
      id: junctionOwner,
      typeId: nodeById.get(junctionNodeId)?.typeId ?? 'Build_PipelineJunction_Cross_C',
      kind: 'junction',
      ...(itemId ? { itemId } : {}),
      inputs: incoming,
      outputs: outgoing,
      directInputs: incoming,
      directOutputs: outgoing,
      inputRoles: incoming.map((id) => ({
        id,
        role: junctionOwners.has(id) ? 'continuation' : 'sink',
      })),
      outputRoles: outgoing.map((id) => ({
        id,
        role: junctionOwners.has(id) ? 'continuation' : 'tap',
      })),
    });
  }

  for (const tankOwner of tankOwners) {
    const tankNodeId = `pipe-tank:${tankOwner}`;
    const networkIndex = networkForNode.get(tankNodeId);
    if (networkIndex === undefined) continue;
    const network = networks[networkIndex] ?? [];
    const items = new Set<string>();
    for (const nodeId of network) {
      const itemId = nodeById.get(nodeId)?.itemId;
      if (itemId) items.add(itemId);
    }
    const itemId = items.size === 1 ? [...items][0] : undefined;
    const incoming = [...new Set(
      runs.filter((run) => run.toNodeId === tankOwner).map((run) => run.fromNodeId),
    )];
    const outgoing = [...new Set(
      runs.filter((run) => run.fromNodeId === tankOwner).map((run) => run.toNodeId),
    )];
    if (incoming.length === 0 && outgoing.length === 0) continue;
    const storedAmount = nodeById.get(tankNodeId)?.storedAmount ?? 0;
    nodes.push({
      id: tankOwner,
      typeId: nodeById.get(tankNodeId)?.typeId ?? 'Build_PipeStorageTank_C',
      kind: 'tank',
      ...(itemId ? { itemId } : {}),
      ...(itemId && storedAmount > 0
        ? { contents: [{ itemId, amount: storedAmount }] }
        : {}),
      storedAmount,
      inputs: incoming,
      outputs: outgoing,
      directInputs: incoming,
      directOutputs: outgoing,
      inputRoles: incoming.map((id) => ({
        id,
        role: junctionOwners.has(id) ? 'continuation' : 'sink',
      })),
      outputRoles: outgoing.map((id) => ({
        id,
        role: junctionOwners.has(id) ? 'continuation' : 'tap',
      })),
    });
  }

  return { nodes, runs };
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
    const isStorage = /Storage/i.test(typeId);
    const transportComponents = componentsByOwner.get(object.instanceName) ?? [];
    const inputComponents = transportComponents.filter(
      (component) => connectionRole(component) === 'in',
    );
    const outputComponents = transportComponents.filter(
      (component) => connectionRole(component) === 'out',
    );
    if (outputComponents.length === 0) continue;
    if (inputComponents.length === 0 && !isStorage) continue;

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
    if (outputs.size === 0 || directOutputs.size === 0) continue;
    if (!isStorage && directInputs.size === 0) continue;

    const storage = index.get(`${object.instanceName}.StorageInventory`);
    const itemId = firstItemIn(storage);
    const contents = isStorage ? storageContents(storage) : undefined;
    const directInputList = [...directInputs].sort();
    const directOutputList = [...directOutputs].sort();
    nodes.push({
      id: object.instanceName,
      typeId,
      kind: /Merger/i.test(typeId) ? 'merger' : /Storage/i.test(typeId) ? 'storage' : 'splitter',
      ...(itemId ? { itemId } : {}),
      ...(contents && contents.length > 0 ? { contents } : {}),
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

  const pipe = collectPipeNetworks(objects, buildings, index, data);
  return { nodes: [...nodes, ...pipe.nodes], runs: [...runMap.values(), ...pipe.runs] };
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
    const fuelInventory = resolveReference(index, getProperty(object, 'mFuelInventory'));
    const shards = countItems(potentialInventory, 'Desc_CrystalShard_C');

    const notes: string[] = [];
    let displayName = typeId;
    let modeled = false;
    let powerConsumption = 0;
    let powerGeneration = 0;
    let inputs: ItemRate[] = [];
    let outputs: ItemRate[] = [];
    let selectedFuel: string | undefined;
    let fuelBuffer: Building['fuelBuffer'];
    let fuelUnknown = false;

    if (generator) {
      displayName = generator.name;
      if (generator.powerProduction > 0) {
        powerGeneration = round(generator.powerProduction * clock);
        modeled = true;
        const fuelCounts = itemCountsIn(fuelInventory);
        const currentFuelId = classNameFromPath(
          referenceName(getProperty(object, 'mCurrentFuelClass')),
        );
        const validFuels = generator.fuels.filter(
          (entry): entry is typeof entry & { item: string } => Boolean(entry.item),
        );
        const inventoryFuel = validFuels
          .map((entry) => ({ entry, count: fuelCounts.get(entry.item) ?? 0 }))
          .filter((entry) => entry.count > 0)
          .sort((a, b) => b.count - a.count)[0];
        const selected =
          inventoryFuel?.entry ??
          validFuels.find((entry) => entry.item === currentFuelId);
        if (!selected || selected.energyMJ <= 0) {
          notes.push(
            'Fuel type and throughput are unknown; generation uses nameplate power.',
          );
          fuelUnknown = true;
        } else {
          const burnRate = (generator.powerProduction * clock * 60) / selected.energyMJ;
          inputs = [{ itemId: selected.item, rate: round(burnRate) }];
          if (selected.supplement && selected.supplementRate) {
            inputs.push({
              itemId: selected.supplement,
              rate: round(selected.supplementRate * clock),
            });
          }
          if (selected.byproduct && selected.byproductAmount > 0) {
            outputs = [
              {
                itemId: selected.byproduct,
                rate: round(burnRate * selected.byproductAmount),
              },
            ];
          }
          selectedFuel = selected.item;
          const bufferedItems = fuelCounts.get(selected.item) ?? 0;
          if (bufferedItems > 0) {
            const runtimeMinutes =
              (bufferedItems * selected.energyMJ) /
              Math.max(0.01, generator.powerProduction * clock * 60);
            fuelBuffer = {
              itemId: selected.item,
              amount: bufferedItems,
              runtimeMinutes: round(runtimeMinutes),
            };
            notes.push(
              `Internal fuel inventory: ${round(bufferedItems)} ${data.items[selected.item]?.name ?? selected.item}, about ${round(runtimeMinutes)} min at full load.`,
            );
          }
        }
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
      ...(selectedFuel ? { selectedFuel } : {}),
      ...(fuelBuffer ? { fuelBuffer } : {}),
      ...(fuelUnknown ? { fuelUnknown: true } : {}),
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
  let transportData = collectTransportNodes(objects, buildings, index, data);
  const storageItems = new Map(
    transportData.nodes
      .filter((node) => node.kind === 'storage' && node.itemId)
      .map((node) => [node.id, node.itemId!]),
  );
  const incomingRuns = new Map<string, string[]>();
  for (const run of transportData.runs) {
    const list = incomingRuns.get(run.toNodeId) ?? [];
    list.push(run.fromNodeId);
    incomingRuns.set(run.toNodeId, list);
  }
  for (const building of buildings) {
    if (!building.modeled || building.selectedFuel || building.inputs.length > 0) continue;
    const generator = data.generators[resolveTypeId(building.typeId)];
    if (!generator) continue;
    const queue = [building.id];
    const visited = new Set<string>();
    let inferred: (typeof generator.fuels)[number] | undefined;
    while (queue.length > 0 && !inferred) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const from of incomingRuns.get(id) ?? []) {
        const itemId = storageItems.get(from);
        if (itemId) {
          inferred = generator.fuels.find((fuel) => fuel.item === itemId);
          if (inferred) break;
        }
        queue.push(from);
      }
    }
    if (!inferred || inferred.energyMJ <= 0) continue;
    const burnRate =
      (generator.powerProduction * building.clock * 60) / inferred.energyMJ;
    building.inputs = [{ itemId: inferred.item!, rate: round(burnRate) }];
    if (inferred.supplement && inferred.supplementRate) {
      building.inputs.push({
        itemId: inferred.supplement,
        rate: round(inferred.supplementRate * building.clock),
      });
    }
    building.outputs =
      inferred.byproduct && inferred.byproductAmount > 0
        ? [
            {
              itemId: inferred.byproduct,
              rate: round(burnRate * inferred.byproductAmount),
            },
          ]
        : [];
    building.selectedFuel = inferred.item;
    delete building.fuelUnknown;
    building.notes = [
      ...(building.notes ?? []).filter(
        (note) => !note.includes('Fuel type and throughput are unknown'),
      ),
      `Fuel inferred from upstream storage: ${data.items[inferred.item!]?.name ?? inferred.item}.`,
    ];
  }
  transportData = collectTransportNodes(objects, buildings, index, data);
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
