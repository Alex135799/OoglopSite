import type { GameData } from '../api/gameData';
import type {
  Building,
  NormalizedSave,
  ProductionLine,
  SplitterNode,
  SupplyControlNode,
  SupplyInputPort,
  SupplyLineModel,
  SupplyNode,
  SupplyOutputPort,
  SupplySourceNode,
  SupplyTransformerNode,
  SupplyTransportNode,
  TransportRun,
} from './types';
import { allocateCappedOutputs, round } from './rateMath';

export interface AssignedTransportNodes {
  transportNodes: SplitterNode[];
  transportRuns: TransportRun[];
}

type MutableNode = SupplyNode & {
  inputs?: SupplyInputPort[];
  outputs?: SupplyOutputPort[];
};

interface EdgeDraft {
  from: string;
  to: string;
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unknown: boolean;
  capacity?: number;
  fromPort?: SupplyOutputPort;
  toPort?: SupplyInputPort;
}

const EPSILON = 1e-6;

const unitFor = (data: GameData, itemId: string): 'items/min' | 'm³/min' => {
  const form = data.items[itemId]?.form;
  return form === 'liquid' || form === 'gas' ? 'm³/min' : 'items/min';
};

const portId = (nodeId: string, direction: 'in' | 'out', index: number) =>
  `${nodeId}:${direction}:${index}`;

const outputPort = (
  node: SupplyNode,
  itemId: string,
  expectedRate: number,
  actualRate: number,
  unknown: boolean,
  index: number,
): SupplyOutputPort => ({
  id: portId(node.id, 'out', index),
  itemId,
  expectedRate,
  actualRate,
  ...(unknown ? { unknown: true } : {}),
});

const inputPort = (
  node: SupplyNode,
  itemId: string,
  expectedRate: number,
  actualRate: number,
  unknown: boolean,
  index: number,
): SupplyInputPort => ({
  id: portId(node.id, 'in', index),
  itemId,
  expectedRate,
  actualRate,
  ...(unknown ? { unknown: true } : {}),
});

const buildingNodeKind = (building: Building, data: GameData) => {
  if (data.extractors[building.typeId] !== undefined) return 'source' as const;
  if (data.generators[building.typeId] !== undefined || building.powerGeneration > 0) {
    return 'generator' as const;
  }
  if (building.inputs.length > 0 && building.outputs.length === 0) return 'sink' as const;
  return 'machine' as const;
};

const buildBuildingNode = (
  building: Building,
  data: GameData,
): SupplyNode => {
  const kind = buildingNodeKind(building, data);
  const unknown = !building.modeled;
  if (kind === 'source') {
    return {
      id: building.id,
      type: 'source',
      displayName: building.displayName,
      position: building.location,
      notes: building.notes,
      clock: building.clock,
      boost: building.boost,
      shards: building.shards,
      expectedPower: building.powerConsumption,
      actualPower: building.powerConsumption,
      outputs: building.outputs.map((rate, index) =>
        outputPort(
          { id: building.id } as SupplyNode,
          rate.itemId,
          rate.rate,
          unknown ? 0 : rate.rate,
          unknown,
          index,
        ),
      ),
    };
  }

  return {
    id: building.id,
    type: 'transformer',
    displayName: building.displayName,
    position: building.location,
    notes: building.notes,
    kind,
    ...(building.recipeId ? { recipeId: building.recipeId } : {}),
    ...(building.recipeName ? { recipeName: building.recipeName } : {}),
    clock: building.clock,
    boost: building.boost,
    shards: building.shards,
    expectedPower: building.powerConsumption,
    actualPower: building.powerConsumption,
    expectedPowerGeneration: building.powerGeneration,
    actualPowerGeneration: building.powerGeneration,
    inputs: building.inputs.map((rate, index) =>
      inputPort({ id: building.id } as SupplyNode, rate.itemId, rate.rate, 0, unknown, index),
    ),
    outputs: building.outputs.map((rate, index) =>
      outputPort(
        { id: building.id } as SupplyNode,
        rate.itemId,
        rate.rate,
        unknown ? 0 : rate.rate,
        unknown,
        index,
      ),
    ),
  };
};

const buildControlNode = (node: SplitterNode): SupplyControlNode => ({
  id: node.id,
  type: 'control',
  kind: node.kind,
  displayName: node.kind === 'storage' ? 'Storage' : node.kind === 'merger' ? 'Merger' : 'Splitter',
  ...(node.itemId ? { itemId: node.itemId } : {}),
  inputs: [],
  outputs: [],
  expectedThroughput: 0,
  actualThroughput: 0,
  ...(node.kind === 'storage' ? { buffered: true } : {}),
  notes: node.itemId ? [`Item: ${node.itemId}`] : undefined,
});

const buildTransportNode = (run: TransportRun): SupplyTransportNode => ({
  id: run.id,
  type: 'transport',
  medium: run.medium,
  displayName: run.medium === 'pipe' ? 'Pipe' : 'Belt',
  inputs: [],
  outputs: [],
  itemId: run.itemId,
  capacity: run.capacity,
  expectedRate: 0,
  actualRate: 0,
  unknown: run.capacity === undefined,
  segmentCount: run.segmentCount,
  fromNodeId: run.fromNodeId,
  toNodeId: run.toNodeId,
  ...(run.capacity === undefined ? { notes: ['Transport capacity is unknown.'] } : {}),
});

const inferEdgeItem = (
  from: SupplyNode,
  to: SupplyNode,
  explicit: string | undefined,
  flows: ProductionLine['flows'],
): string => {
  if (explicit && explicit !== 'unknown') return explicit;
  const fromNode = from as MutableNode;
  const toNode = to as MutableNode;
  const flow = flows.find(
    (entry) =>
      (entry.from === from.id && entry.to === to.id) ||
      (entry.from === to.id && entry.to === from.id),
  );
  if (flow) return flow.itemId;
  if (fromNode.outputs?.length === 1) return fromNode.outputs[0].itemId;
  if (toNode.inputs?.length === 1) return toNode.inputs[0].itemId;
  return 'unknown';
};

export const buildSupplyLineModel = (
  model: NormalizedSave,
  line: ProductionLine,
  data: GameData,
  assigned: AssignedTransportNodes,
): SupplyLineModel => {
  const buildings = new Map(
    model.buildings
      .filter((building) => line.buildingIds.includes(building.id))
      .map((building) => [building.id, building]),
  );
  const nodes: Record<string, SupplyNode> = {};
  for (const building of buildings.values()) {
    nodes[building.id] = buildBuildingNode(building, data);
  }
  const controlIds = new Set<string>();
  for (const transport of assigned.transportNodes) {
    nodes[transport.id] = buildControlNode(transport);
    controlIds.add(transport.id);
  }
  for (const run of assigned.transportRuns) {
    nodes[run.id] = buildTransportNode(run);
  }

  for (const transport of assigned.transportNodes) {
    const control = nodes[transport.id];
    if (control?.type !== 'control' || control.itemId) continue;
    const counts = new Map<string, number>();
    for (const id of transport.inputs) {
      const building = buildings.get(id);
      for (const item of building?.outputs ?? []) {
        counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1);
      }
    }
    for (const id of transport.outputs) {
      const building = buildings.get(id);
      for (const item of building?.inputs ?? []) {
        counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1);
      }
    }
    const itemId = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
    if (itemId) control.itemId = itemId;
  }

  const runPairs = new Set(
    assigned.transportRuns.map((run) => `${run.fromNodeId}\u0000${run.toNodeId}`),
  );
  const drafts: EdgeDraft[] = [];
  const draftKeys = new Set<string>();

  const addDraft = (
    fromId: string,
    toId: string,
    explicitItem: string | undefined,
    capacity?: number,
  ) => {
    const from = nodes[fromId];
    const to = nodes[toId];
    if (!from || !to || fromId === toId) return;
    const itemId = inferEdgeItem(from, to, explicitItem, line.flows);
    const key = `${fromId}\u0000${toId}\u0000${itemId}`;
    if (draftKeys.has(key)) return;
    draftKeys.add(key);
    const unknown = itemId === 'unknown' || (from as MutableNode).notes?.some((note) => note.includes('unknown')) === true;
    drafts.push({
      from: fromId,
      to: toId,
      itemId,
      expectedRate: 0,
      actualRate: 0,
      unknown,
      ...(capacity !== undefined ? { capacity } : {}),
    });
  };

  for (const run of assigned.transportRuns) {
    const fromNode = nodes[run.fromNodeId] as SupplyNode | undefined;
    const toNode = nodes[run.toNodeId] as SupplyNode | undefined;
    const fromOutputs = (fromNode as MutableNode | undefined)?.outputs ?? [];
    const toInputs = (toNode as MutableNode | undefined)?.inputs ?? [];
    const runItem =
      run.itemId ??
      (fromNode?.type === 'control' ? fromNode.itemId : undefined) ??
      (toNode?.type === 'control' ? toNode.itemId : undefined) ??
      (fromOutputs.length === 1 ? fromOutputs[0].itemId : undefined) ??
      (toInputs.length === 1 ? toInputs[0].itemId : undefined);
    addDraft(run.fromNodeId, run.id, runItem, run.capacity);
    addDraft(run.id, run.toNodeId, runItem, run.capacity);
  }

  for (const transport of assigned.transportNodes) {
    const control = nodes[transport.id];
    const itemId =
      control?.type === 'control' ? control.itemId ?? transport.itemId : transport.itemId;
    for (const input of transport.directInputs ?? transport.inputs) {
      if (runPairs.has(`${input}\u0000${transport.id}`)) continue;
      addDraft(input, transport.id, itemId);
    }
    for (const output of transport.directOutputs ?? transport.outputs) {
      if (runPairs.has(`${transport.id}\u0000${output}`)) continue;
      addDraft(transport.id, output, itemId);
    }
  }

  const rawAdjacency = new Map<string, Set<string>>();
  for (const draft of drafts) {
    const list = rawAdjacency.get(draft.from) ?? new Set<string>();
    list.add(draft.to);
    rawAdjacency.set(draft.from, list);
  }
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      for (const next of rawAdjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    return false;
  };
  for (const flow of line.flows) {
    if (!nodes[flow.from] || !nodes[flow.to]) continue;
    if (reaches(flow.from, flow.to)) continue;
    drafts.push({
      from: flow.from,
      to: flow.to,
      itemId: flow.itemId,
      expectedRate: flow.rate,
      actualRate: flow.rate,
      unknown: flow.itemId === 'unknown',
    });
  }

  const addOutputPort = (
    nodeId: string,
    itemId: string,
    expected: number,
    actual: number,
    unknown: boolean,
  ): SupplyOutputPort | undefined => {
    const node = nodes[nodeId] as MutableNode;
    if (!node.outputs) return undefined;
    if (node.type === 'source' || node.type === 'transformer') {
      const existing = node.outputs.find((port) => port.itemId === itemId);
      if (existing) {
        if (actual > existing.actualRate) existing.actualRate = actual;
        if (unknown) existing.unknown = true;
        return existing;
      }
    }
    const port = outputPort(node, itemId, expected, actual, unknown, node.outputs.length);
    node.outputs.push(port);
    return port;
  };

  const addInputPort = (
    nodeId: string,
    itemId: string,
    expected: number,
    actual: number,
    unknown: boolean,
  ): SupplyInputPort | undefined => {
    const node = nodes[nodeId] as MutableNode;
    if (!node.inputs) return undefined;
    if (node.type === 'transformer') {
      const existing = node.inputs.find(
        (port) => port.itemId === itemId && !port.previousNodeId,
      );
      if (existing) {
        existing.actualRate = actual;
        if (unknown) existing.unknown = true;
        return existing;
      }
    }
    const port = inputPort(node, itemId, expected, actual, unknown, node.inputs.length);
    node.inputs.push(port);
    return port;
  };

  for (const draft of drafts) {
    const from = nodes[draft.from] as MutableNode;
    const to = nodes[draft.to] as MutableNode;
    const expected =
      draft.expectedRate ||
      from.outputs?.find((port) => port.itemId === draft.itemId)?.expectedRate ||
      to.inputs?.find((port) => port.itemId === draft.itemId)?.expectedRate ||
      0;
    const outPort = addOutputPort(
      draft.from,
      draft.itemId,
      expected,
      draft.actualRate,
      draft.unknown,
    );
    const inPort = addInputPort(draft.to, draft.itemId, expected, draft.actualRate, draft.unknown);
    if (outPort && inPort) {
      const nextNodeIds = new Set(outPort.nextNodeIds ?? []);
      if (outPort.nextNodeId) nextNodeIds.add(outPort.nextNodeId);
      nextNodeIds.add(draft.to);
      outPort.nextNodeIds = [...nextNodeIds];
      outPort.nextNodeId = outPort.nextNodeId ?? draft.to;
      inPort.previousNodeId = draft.from;
      draft.fromPort = outPort;
      draft.toPort = inPort;
    }
  }

  const incoming = new Map<string, EdgeDraft[]>();
  const outgoing = new Map<string, EdgeDraft[]>();
  for (const draft of drafts) {
    const inList = incoming.get(draft.to) ?? [];
    inList.push(draft);
    incoming.set(draft.to, inList);
    const outList = outgoing.get(draft.from) ?? [];
    outList.push(draft);
    outgoing.set(draft.from, outList);
  }

  const indegree = new Map<string, number>();
  for (const id of Object.keys(nodes)) indegree.set(id, 0);
  for (const draft of drafts) indegree.set(draft.to, (indegree.get(draft.to) ?? 0) + 1);
  const queue = [...indegree.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const edge of outgoing.get(id) ?? []) {
      const next = (indegree.get(edge.to) ?? 1) - 1;
      indegree.set(edge.to, next);
      if (next === 0) queue.push(edge.to);
    }
  }
  const cyclic = new Set(Object.keys(nodes).filter((id) => !order.includes(id)));
  for (const id of cyclic) {
    const node = nodes[id];
    node.notes = [...(node.notes ?? []), 'Actual flow is unknown because this node is part of a cycle.'];
  }

  const setEdgeUnknown = (edge: EdgeDraft) => {
    edge.unknown = true;
    edge.actualRate = 0;
    if (edge.fromPort) edge.fromPort.unknown = true;
    if (edge.toPort) edge.toPort.unknown = true;
  };

  for (const id of order) {
    const node = nodes[id];
    const inEdges = incoming.get(id) ?? [];
    const outEdges = outgoing.get(id) ?? [];
    const unknownInput = inEdges.some((edge) => edge.unknown);
    const inputActual = inEdges.reduce((sum, edge) => sum + edge.actualRate, 0);

    if (node.type === 'source') {
      const edgesByItem = new Map<string, EdgeDraft[]>();
      for (const edge of outEdges) {
        const list = edgesByItem.get(edge.itemId) ?? [];
        list.push(edge);
        edgesByItem.set(edge.itemId, list);
      }
      for (const [itemId, edges] of edgesByItem) {
        const port = node.outputs.find((entry) => entry.itemId === itemId);
        const rate = (port?.expectedRate ?? edges[0].expectedRate) / edges.length;
        for (const edge of edges) {
          edge.actualRate = rate;
          if (edge.fromPort) edge.fromPort.actualRate = rate;
          if (edge.toPort) edge.toPort.actualRate = rate;
          if (port?.unknown) setEdgeUnknown(edge);
        }
      }
      node.actualPower = node.expectedPower;
      for (const port of node.outputs) port.actualRate = port.expectedRate;
      continue;
    }

    if (node.type === 'control') {
      const expected = inEdges.reduce((sum, edge) => sum + edge.expectedRate, 0);
      node.expectedThroughput = round(expected);
      node.actualThroughput = round(inputActual);
      if (node.kind === 'splitter') {
        const capacities = outEdges.map((edge) => {
          const target = nodes[edge.to];
          return target?.type === 'transport' ? target.capacity : undefined;
        });
        const allocation = unknownInput
          ? { rates: outEdges.map(() => 0), delivered: 0, limited: false }
          : allocateCappedOutputs(inputActual, capacities);
        outEdges.forEach((edge, index) => {
          edge.actualRate = allocation.rates[index] ?? 0;
          if (edge.fromPort) edge.fromPort.actualRate = edge.actualRate;
          if (edge.toPort) edge.toPort.actualRate = edge.actualRate;
          if (unknownInput) setEdgeUnknown(edge);
        });
        node.bottleneck = !unknownInput && allocation.limited;
        if (node.bottleneck) {
          const itemId = node.itemId ?? outEdges[0]?.itemId ?? 'unknown';
          const unit = unitFor(data, itemId);
          node.notes = [
            ...(node.notes ?? []),
            `Output belts limit throughput: input ${round(inputActual)} ${unit}, delivered ${round(allocation.delivered)} ${unit}.`,
          ];
        }
      } else {
        const equal = outEdges.length > 0 ? inputActual / outEdges.length : 0;
        for (const edge of outEdges) {
          edge.actualRate = unknownInput ? 0 : equal;
          if (edge.fromPort) edge.fromPort.actualRate = edge.actualRate;
          if (edge.toPort) edge.toPort.actualRate = edge.actualRate;
          if (unknownInput) setEdgeUnknown(edge);
        }
        if (node.kind === 'storage') {
          node.notes = [...(node.notes ?? []), 'Storage is treated as pass-through; contents are not modeled.'];
        }
      }
      continue;
    }

    if (node.type === 'transport') {
      const capacity = node.capacity;
      const actual = capacity === undefined ? 0 : Math.min(inputActual, capacity);
      const unknown = unknownInput || capacity === undefined || node.itemId === 'unknown';
      node.actualRate = round(actual);
      node.expectedRate = round(inEdges.reduce((sum, edge) => sum + edge.expectedRate, 0));
      if (unknown) node.unknown = true;
      for (const edge of outEdges) {
        edge.actualRate = actual;
        if (edge.fromPort) edge.fromPort.actualRate = actual;
        if (edge.toPort) edge.toPort.actualRate = actual;
        if (unknown) setEdgeUnknown(edge);
      }
      continue;
    }

    const expectedInputs = node.inputs.filter((port) => port.expectedRate > EPSILON);
    const ratios = expectedInputs.map((port) => {
      const actual = inEdges
        .filter((edge) => edge.itemId === port.itemId)
        .reduce((sum, edge) => sum + edge.actualRate, 0);
      return port.expectedRate > EPSILON ? actual / port.expectedRate : 1;
    });
    const ratio = unknownInput ? 0 : ratios.length > 0 ? Math.min(...ratios) : 1;
    const unknown = unknownInput || node.inputs.some((port) => port.unknown);

    node.actualPower = round(node.expectedPower * ratio);
    node.actualPowerGeneration = round(node.expectedPowerGeneration * ratio);
    for (const port of node.inputs) {
      const actual = inEdges
        .filter((edge) => edge.itemId === port.itemId)
        .reduce((sum, edge) => sum + edge.actualRate, 0);
      port.actualRate = unknown ? 0 : round(Math.min(actual, port.expectedRate * ratio));
      if (unknown) port.unknown = true;
    }
    for (const port of node.outputs) {
      port.actualRate = unknown ? 0 : round(port.expectedRate * ratio);
      if (unknown) port.unknown = true;
    }
    const edgesByItem = new Map<string, EdgeDraft[]>();
    for (const edge of outEdges) {
      const list = edgesByItem.get(edge.itemId) ?? [];
      list.push(edge);
      edgesByItem.set(edge.itemId, list);
    }
    for (const [itemId, edges] of edgesByItem) {
      const port = node.outputs.find((entry) => entry.itemId === itemId);
      const rate = ((port?.expectedRate ?? edges[0].expectedRate) * ratio) / edges.length;
      for (const edge of edges) {
        edge.actualRate = unknown ? 0 : round(rate);
        if (edge.fromPort) edge.fromPort.actualRate = edge.actualRate;
        if (edge.toPort) edge.toPort.actualRate = edge.actualRate;
        if (unknown) setEdgeUnknown(edge);
      }
    }
  }

  const producersFor = (startId: string): string[] => {
    const found = new Set<string>();
    const seen = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of incoming.get(current) ?? []) {
        if (seen.has(edge.from)) continue;
        seen.add(edge.from);
        const upstream = nodes[edge.from];
        if (upstream.type === 'source' || upstream.type === 'transformer') {
          found.add(upstream.id);
          continue;
        }
        queue.push(edge.from);
      }
    }
    return [...found].sort();
  };
  for (const node of Object.values(nodes)) {
    if (node.type === 'transformer') node.producerIds = producersFor(node.id);
  }

  const summaryInputs = new Map<string, { expected: number; actual: number; unknown: boolean }>();
  const summaryOutputs = new Map<string, { expected: number; actual: number; unknown: boolean }>();
  for (const node of Object.values(nodes) as MutableNode[]) {
    for (const port of node.inputs ?? []) {
      if (port.previousNodeId && nodes[port.previousNodeId]) continue;
      const entry = summaryInputs.get(port.itemId) ?? { expected: 0, actual: 0, unknown: false };
      entry.expected += port.expectedRate;
      entry.actual += port.actualRate;
      entry.unknown ||= port.unknown === true;
      summaryInputs.set(port.itemId, entry);
    }
    for (const port of node.outputs ?? []) {
      const hasNext =
        (port.nextNodeIds?.length ?? 0) > 0 || Boolean(port.nextNodeId && nodes[port.nextNodeId]);
      if (hasNext) continue;
      const entry = summaryOutputs.get(port.itemId) ?? { expected: 0, actual: 0, unknown: false };
      entry.expected += port.expectedRate;
      entry.actual += port.actualRate;
      entry.unknown ||= port.unknown === true;
      summaryOutputs.set(port.itemId, entry);
    }
  }

  const toSummaries = (
    map: Map<string, { expected: number; actual: number; unknown: boolean }>,
  ) =>
    [...map.entries()]
      .map(([itemId, entry]) => ({
        itemId,
        expectedRate: round(entry.expected),
        actualRate: round(entry.actual),
        unit: unitFor(data, itemId),
        ...(entry.unknown ? { unknown: true } : {}),
      }))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

  const inputActualFor = (id: string): number =>
    (incoming.get(id) ?? []).reduce((sum, edge) => sum + edge.actualRate, 0);

  const bottlenecks = Object.values(nodes).flatMap((node) => {
    if (node.type === 'transformer') {
      const expected = node.outputs.reduce((sum, port) => sum + port.expectedRate, 0);
      const actual = node.outputs.reduce((sum, port) => sum + port.actualRate, 0);
      if (actual + EPSILON < expected) {
        return [
          {
            nodeId: node.id,
            expectedRate: round(expected),
            actualRate: round(actual),
            reason: 'Transformer input starvation',
          },
        ];
      }
    }
    if (node.type === 'transport' && node.unknown) {
      return [
        {
          nodeId: node.id,
          expectedRate: node.expectedRate,
          actualRate: node.actualRate,
          reason: 'Transport capacity or item is unknown',
        },
      ];
    }
    if (node.type === 'control' && node.kind === 'splitter' && node.bottleneck) {
      const outEdges = outgoing.get(node.id) ?? [];
      const delivered = outEdges.reduce((sum, edge) => sum + edge.actualRate, 0);
      const itemId = node.itemId ?? outEdges[0]?.itemId;
      return [
        {
          nodeId: node.id,
          ...(itemId ? { itemId } : {}),
          expectedRate: round(inputActualFor(node.id)),
          actualRate: round(delivered),
          reason: 'Splitter output belts limit flow',
        },
      ];
    }
    return [];
  });

  return {
    id: line.id,
    name: line.name,
    roots: Object.values(nodes)
      .filter((node) => node.type === 'source')
      .map((node) => node.id)
      .sort(),
    nodes,
    summary: {
      inputs: toSummaries(summaryInputs),
      outputs: toSummaries(summaryOutputs),
      power: {
        expectedConsumption: round(
          Object.values(nodes).reduce((sum, node) => {
            if (node.type === 'source') return sum + node.expectedPower;
            if (node.type === 'transformer') return sum + node.expectedPower;
            return sum;
          }, 0),
        ),
        actualConsumption: round(
          Object.values(nodes).reduce((sum, node) => {
            if (node.type === 'source') return sum + node.actualPower;
            if (node.type === 'transformer') return sum + node.actualPower;
            return sum;
          }, 0),
        ),
        expectedGeneration: round(
          Object.values(nodes).reduce(
            (sum, node) => sum + (node.type === 'transformer' ? node.expectedPowerGeneration : 0),
            0,
          ),
        ),
        actualGeneration: round(
          Object.values(nodes).reduce(
            (sum, node) => sum + (node.type === 'transformer' ? node.actualPowerGeneration : 0),
            0,
          ),
        ),
      },
      bottlenecks,
    },
    notes: [
      ...(cyclic.size > 0 ? ['The line contains a cycle; affected actual rates are unknown.'] : []),
      'TODO: downstream demand/backpressure is not yet modeled.',
    ],
    buildingIds: [...buildings.keys()],
    transportNodeIds: assigned.transportNodes.map((node) => node.id),
  };
};
