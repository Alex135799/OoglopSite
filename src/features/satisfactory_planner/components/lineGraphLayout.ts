import dagre from '@dagrejs/dagre';
import type {
  Finding,
  SupplyControlNode,
  SupplyLineModel,
  SupplyNode,
  SupplyTransformerNode,
} from '../domain/types';

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 86;
export const CONTROL_SIZE = 44;
export const STACK_GAP = 44;
export const CONTROL_GAP = 140;
export const COLUMN_GAP = 44;
export const SLOT_PITCH = 116;

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  itemId: string;
  actualRate: number;
  unknown: boolean;
  atCapacity: boolean;
  transportNodeIds: string[];
  beltActualRate?: number;
  beltCapacity?: number;
  transportCount: number;
}

export interface MachineAttachment {
  controlId: string;
  machineId: string;
  connectedPorts: Array<{ machineId: string; fraction: number }>;
  stackId: string;
  side: 'left' | 'right';
  portOrder: number;
  columnIndex: number;
  slotIndex: number;
  slotCount: number;
}

export interface LayoutResult {
  visibleIds: string[];
  hiddenCount: number;
  problemIds: Set<string>;
  edges: GraphEdge[];
  positions: Map<string, { x: number; y: number }>;
  heights: Map<string, number>;
  attachments: MachineAttachment[];
  stackOf: Map<string, string>;
  unitOf: Map<string, string>;
  unitBounds: Map<string, { x: number; y: number; width: number; height: number }>;
}

export interface ColumnGapDemand {
  leftUnitId: string;
  rightUnitId: string;
  requiredGap: number;
}

interface StackUnit {
  id: string;
  key: string;
  machines: string[];
  leftWidth: number;
  rightWidth: number;
  width: number;
  height: number;
  rowHeight: number;
}

const isMachine = (node: SupplyNode | undefined): boolean =>
  node?.type === 'source' || node?.type === 'transformer';

const stackKeyOf = (node: SupplyNode): string => {
  if (node.type === 'transformer' && node.recipeId) return `recipe:${node.recipeId}`;
  return `machine:${node.id}`;
};

const machineChainOrder = (
  line: SupplyLineModel,
  edges: GraphEdge[],
): Map<string, number> => {
  const nextControls = new Map<string, string[]>();
  const taps = new Map<string, string[]>();
  const hasControlInput = new Set<string>();
  const add = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };

  for (const edge of edges) {
    const from = line.nodes[edge.from];
    const to = line.nodes[edge.to];
    if (from?.type === 'control' && to?.type === 'control') {
      add(nextControls, from.id, to.id);
      hasControlInput.add(to.id);
    }
    if (from?.type === 'control' && isMachine(to)) add(taps, from.id, to.id);
    if (to?.type === 'control' && isMachine(from)) add(taps, to.id, from.id);
  }

  const machineSort = (a: string, b: string): number => {
    const ax = line.nodes[a]?.position?.x ?? Number.NEGATIVE_INFINITY;
    const bx = line.nodes[b]?.position?.x ?? Number.NEGATIVE_INFINITY;
    if (ax !== bx) return bx - ax;
    return a.localeCompare(b);
  };
  for (const list of taps.values()) list.sort(machineSort);
  for (const list of nextControls.values()) list.sort();

  const controls = Object.values(line.nodes)
    .filter((node) => node.type === 'control')
    .map((node) => node.id)
    .sort();
  const roots = controls.filter((id) => !hasControlInput.has(id));
  const order = new Map<string, number>();
  const visited = new Set<string>();
  let sequence = 0;

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const machineId of taps.get(id) ?? []) {
      if (!order.has(machineId)) order.set(machineId, sequence++);
    }
    for (const next of nextControls.get(id) ?? []) visit(next);
  };

  for (const id of [...roots, ...controls]) visit(id);
  return order;
};

export const collapseTransport = (line: SupplyLineModel): GraphEdge[] => {
  const merged = new Map<string, GraphEdge>();
  for (const node of Object.values(line.nodes)) {
    if (node.type === 'transport') continue;
    for (const port of node.outputs ?? []) {
      const starts = port.nextNodeIds ?? (port.nextNodeId ? [port.nextNodeId] : []);
      for (const startId of starts) {
        let nextId: string | undefined = startId;
        let guard = 0;
        const transportedIds: string[] = [];
        const capacities: number[] = [];
        const transportedActuals: number[] = [];
        while (nextId && line.nodes[nextId]?.type === 'transport' && guard < 20) {
          const transport = line.nodes[nextId] as SupplyNode;
          if (transport.type !== 'transport') break;
          transportedIds.push(transport.id);
          if (transport.capacity !== undefined) capacities.push(transport.capacity);
          transportedActuals.push(transport.actualRate);
          const nextPort = transport.outputs?.[0];
          nextId = nextPort?.nextNodeId ?? nextPort?.nextNodeIds?.[0];
          guard += 1;
        }
        if (!nextId || nextId === node.id) continue;
        const target = line.nodes[nextId];
        if (!target || target.type === 'transport') continue;
        const key = `${node.id}\u0000${nextId}\u0000${port.itemId}`;
        const beltActualRate =
          transportedActuals.length > 0
            ? Math.min(port.actualRate, ...transportedActuals)
            : undefined;
        const beltCapacity =
          capacities.length > 0 && capacities.length === transportedIds.length
            ? Math.min(...capacities)
            : undefined;
        const existing = merged.get(key);
        if (existing) {
          existing.actualRate += port.actualRate;
          existing.unknown ||= port.unknown === true;
          existing.transportNodeIds = [...new Set([...existing.transportNodeIds, ...transportedIds])];
          existing.transportCount = existing.transportNodeIds.length;
          if (existing.beltActualRate === undefined) existing.beltActualRate = beltActualRate;
          else if (beltActualRate !== undefined) {
            existing.beltActualRate = Math.min(existing.beltActualRate, beltActualRate);
          }
          if (existing.beltCapacity === undefined) existing.beltCapacity = beltCapacity;
          else if (beltCapacity !== undefined) {
            existing.beltCapacity = Math.min(existing.beltCapacity, beltCapacity);
          }
          existing.atCapacity =
            existing.beltCapacity !== undefined &&
            existing.beltActualRate !== undefined &&
            existing.beltActualRate + 1e-6 >= existing.beltCapacity;
          continue;
        }
        merged.set(key, {
          id: key,
          from: node.id,
          to: nextId,
          itemId: port.itemId,
          actualRate: port.actualRate,
          unknown: port.unknown === true,
          atCapacity:
            beltCapacity !== undefined &&
            beltActualRate !== undefined &&
            beltActualRate + 1e-6 >= beltCapacity,
          transportNodeIds: transportedIds,
          ...(beltActualRate !== undefined ? { beltActualRate } : {}),
          ...(beltCapacity !== undefined ? { beltCapacity } : {}),
          transportCount: transportedIds.length,
        });
      }
    }
  }
  return [...merged.values()];
};


const portOrder = (
  ports: { itemId: string }[],
  itemId: string,
): number => {
  const index = ports.findIndex((port) => port.itemId === itemId);
  return index < 0 ? 0 : index;
};

export const portFraction = (
  ports: Array<{ itemId: string }> | undefined,
  itemId: string,
): number => {
  const items = [...new Set((ports ?? []).map((port) => port.itemId))];
  const index = items.indexOf(itemId);
  return index < 0 ? 0.5 : (index + 1) / (items.length + 1);
};

const buildAttachments = (
  line: SupplyLineModel,
  edges: GraphEdge[],
  visible: Set<string>,
  stackOf: Map<string, string>,
  machineOrder: Map<string, number>,
): MachineAttachment[] => {
  const attachments: MachineAttachment[] = [];
  const byControl = new Map<string, MachineAttachment>();

  for (const node of Object.values(line.nodes)) {
    if (node.type !== 'control' || !visible.has(node.id)) continue;
    const leftEdges = edges
      .filter((edge) => edge.from === node.id && isMachine(line.nodes[edge.to]))
      .sort((a, b) => a.to.localeCompare(b.to) || a.itemId.localeCompare(b.itemId));
    const rightEdges = edges
      .filter((edge) => edge.to === node.id && isMachine(line.nodes[edge.from]))
      .sort((a, b) => a.from.localeCompare(b.from) || a.itemId.localeCompare(b.itemId));
    let side: 'left' | 'right';
    if (node.kind === 'merger' && rightEdges.length > 0) side = 'right';
    else if (node.kind === 'splitter' && leftEdges.length > 0) side = 'left';
    else side = leftEdges.length > 0 ? 'left' : rightEdges.length > 0 ? 'right' : 'left';
    const candidates = side === 'left' ? leftEdges : rightEdges;
    if (candidates.length === 0) continue;

    const chosen = [...candidates].sort(
      (a, b) =>
        (machineOrder.get(side === 'left' ? a.to : a.from) ?? Number.MAX_SAFE_INTEGER) -
          (machineOrder.get(side === 'left' ? b.to : b.from) ?? Number.MAX_SAFE_INTEGER) ||
        (side === 'left' ? a.to : a.from).localeCompare(side === 'left' ? b.to : b.from),
    )[0];
    const machineId = side === 'left' ? chosen.to : chosen.from;
    const machine = line.nodes[machineId];
    if (!machine || !visible.has(machineId)) continue;

    const machinePorts =
      side === 'left'
        ? machine.type === 'transformer'
          ? machine.inputs
          : []
        : machine.outputs;
    const order = portOrder(machinePorts, chosen.itemId);
    const connectedPorts = candidates
      .map((candidate) => {
        const id = side === 'left' ? candidate.to : candidate.from;
        const connected = line.nodes[id];
        const ports =
          side === 'left' && connected?.type === 'transformer'
            ? connected.inputs
            : side === 'right'
              ? connected?.outputs
              : undefined;
        return { machineId: id, fraction: portFraction(ports, candidate.itemId) };
      })
      .filter((entry) => visible.has(entry.machineId));
    const attachment: MachineAttachment = {
      controlId: node.id,
      machineId,
      connectedPorts,
      stackId: stackOf.get(machineId) ?? machineId,
      side,
      portOrder: order,
      columnIndex: order,
      slotIndex: 0,
      slotCount: 1,
    };
    byControl.set(node.id, attachment);
  }

  const groups = new Map<string, MachineAttachment[]>();
  for (const attachment of byControl.values()) {
    const key = `${attachment.machineId}|${attachment.side}|${attachment.portOrder}`;
    const list = groups.get(key) ?? [];
    list.push(attachment);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.controlId.localeCompare(b.controlId));
    list.forEach((attachment, index) => {
      attachment.slotIndex = index;
      attachment.slotCount = list.length;
    });
    attachments.push(...list);
  }
  return attachments;
};

const unitId = (id: string) => `unit:${id}`;

export const layoutSupplyGraph = (
  line: SupplyLineModel,
  findings: Finding[],
  problemsOnly: boolean,
  maxNodes: number,
): LayoutResult => {
  const nonTransport = Object.values(line.nodes)
    .filter((node) => node.type !== 'transport')
    .map((node) => node.id)
    .sort();
  const allNodeIds = new Set(nonTransport);
  const problemIds = new Set([
    ...findings.flatMap((finding) => finding.buildingIds ?? []),
    ...line.summary.bottlenecks.map((entry) => entry.nodeId),
  ].filter((id) => allNodeIds.has(id)));
  const collapsed = collapseTransport(line);

  let keep = new Set(allNodeIds);
  if (problemsOnly && problemIds.size > 0) {
    keep = new Set(problemIds);
    for (const edge of collapsed) {
      if (problemIds.has(edge.from) || problemIds.has(edge.to)) {
        keep.add(edge.from);
        keep.add(edge.to);
      }
    }
  } else if (problemsOnly) {
    keep = new Set();
  }

  const ordered = [...keep].sort();
  const hiddenCount = Math.max(0, ordered.length - maxNodes);
  const visibleIds = ordered.slice(0, maxNodes);
  const visible = new Set(visibleIds);
  const edges = collapsed.filter(
    (edge) => visible.has(edge.from) && visible.has(edge.to),
  );

  const machineNodes = visibleIds
    .map((id) => line.nodes[id])
    .filter((node): node is SupplyNode => isMachine(node));
  const stacks = new Map<string, string[]>();
  for (const machine of machineNodes) {
    const key = stackKeyOf(machine);
    const members = stacks.get(key) ?? [];
    members.push(machine.id);
    stacks.set(key, members);
  }
  const chainOrder = machineChainOrder(line, edges);
  for (const members of stacks.values()) {
    members.sort((a, b) => {
      const ao = chainOrder.get(a);
      const bo = chainOrder.get(b);
      if (ao !== undefined || bo !== undefined) {
        if (ao === undefined) return 1;
        if (bo === undefined) return -1;
        if (ao !== bo) return ao - bo;
      }
      return a.localeCompare(b);
    });
  }

  const stackOf = new Map<string, string>();
  for (const [key, members] of stacks) {
    for (const id of members) stackOf.set(id, key);
  }

  const stackList = [...stacks.entries()]
    .map(([key, machines]) => ({ key, machines }))
    .sort((a, b) => a.machines[0].localeCompare(b.machines[0]));
  const machineOrder = new Map<string, number>();
  let orderIndex = 0;
  for (const stack of stackList) {
    for (const id of stack.machines) machineOrder.set(id, orderIndex++);
  }

  const attachments = buildAttachments(line, edges, visible, stackOf, machineOrder);
  const attachmentByControl = new Map(attachments.map((entry) => [entry.controlId, entry]));

  const rowHeightByMachine = new Map<string, number>();
  for (const id of visibleIds) {
    if (isMachine(line.nodes[id])) rowHeightByMachine.set(id, NODE_HEIGHT);
  }
  const maxSlotsByMachinePort = new Map<string, number>();
  for (const attachment of attachments) {
    const key = `${attachment.machineId}|${attachment.portOrder}`;
    maxSlotsByMachinePort.set(
      key,
      Math.max(maxSlotsByMachinePort.get(key) ?? 0, attachment.slotCount),
    );
  }
  for (const [key, slots] of maxSlotsByMachinePort) {
    const [machineId] = key.split('|');
    rowHeightByMachine.set(
      machineId,
      Math.max(NODE_HEIGHT, slots * SLOT_PITCH),
    );
  }

  const units: {
    id: string;
    width: number;
    height: number;
    kind: 'stack' | 'control';
    stack?: StackUnit;
  }[] = [];
  const stackUnits = new Map<string, StackUnit>();
  for (const stack of stackList) {
    const rowHeight = Math.max(
      NODE_HEIGHT,
      ...stack.machines.map((id) => rowHeightByMachine.get(id) ?? NODE_HEIGHT),
    );
    for (const id of stack.machines) rowHeightByMachine.set(id, rowHeight);
    const stackAttachments = attachments.filter((entry) => entry.stackId === stack.key);
    const leftColumns =
      Math.max(0, ...stackAttachments.filter((entry) => entry.side === 'left').map((entry) => entry.columnIndex + 1));
    const rightColumns =
      Math.max(0, ...stackAttachments.filter((entry) => entry.side === 'right').map((entry) => entry.columnIndex + 1));
    const leftWidth =
      leftColumns > 0
        ? CONTROL_GAP + CONTROL_SIZE + (leftColumns - 1) * (CONTROL_SIZE + COLUMN_GAP)
        : 0;
    const rightWidth =
      rightColumns > 0
        ? CONTROL_GAP + CONTROL_SIZE + (rightColumns - 1) * (CONTROL_SIZE + COLUMN_GAP)
        : 0;
    const height = stack.machines.length * rowHeight + (stack.machines.length - 1) * STACK_GAP;
    const unit: StackUnit = {
      id: unitId(stack.key),
      key: stack.key,
      machines: stack.machines,
      leftWidth,
      rightWidth,
      width: leftWidth + NODE_WIDTH + rightWidth,
      height,
      rowHeight,
    };
    stackUnits.set(stack.key, unit);
    units.push({ id: unit.id, width: unit.width, height: unit.height, kind: 'stack', stack: unit });
  }

  const attachedControlIds = new Set(attachmentByControl.keys());
  const controlUnits = new Map<string, string>();
  for (const id of visibleIds) {
    const node = line.nodes[id];
    if (node?.type !== 'control' || attachedControlIds.has(id)) continue;
    const uid = unitId(id);
    controlUnits.set(id, uid);
    units.push({ id: uid, width: CONTROL_SIZE, height: CONTROL_SIZE, kind: 'control' });
  }

  const unitForNode = (id: string): string | undefined => {
    if (controlUnits.has(id)) return controlUnits.get(id);
    if (attachedControlIds.has(id)) {
      const attachment = attachmentByControl.get(id)!;
      const stack = stackUnits.get(attachment.stackId);
      return stack?.id;
    }
    const stackId = stackOf.get(id);
    return stackId ? stackUnits.get(stackId)?.id : undefined;
  };

  const layoutEdges = new Map<string, { source: string; target: string }>();
  for (const edge of edges) {
    const source = unitForNode(edge.from);
    const target = unitForNode(edge.to);
    if (!source || !target || source === target) continue;
    layoutEdges.set(`${source}\u0000${target}`, { source, target });
  }

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 150, ranksep: 320, marginx: 20, marginy: 20 });
  for (const unit of units) graph.setNode(unit.id, { width: unit.width, height: unit.height });
  for (const edge of layoutEdges.values()) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  const heights = new Map<string, number>();
  const unitBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const unit of units) {
    const point = graph.node(unit.id);
    if (!point) continue;
    const left = point.x - unit.width / 2;
    const top = point.y - unit.height / 2;
    unitBounds.set(unit.id, { x: left, y: top, width: unit.width, height: unit.height });
    if (unit.kind === 'control') {
      const id = unit.id.replace(/^unit:/, '');
      positions.set(id, { x: left, y: top });
      heights.set(id, CONTROL_SIZE);
      continue;
    }
    const stack = unit.stack!;
    const machineLeft = left + stack.leftWidth;
    stack.machines.forEach((id, index) => {
      const rowHeight = stack.rowHeight;
      const y = top + index * (rowHeight + STACK_GAP);
      positions.set(id, { x: machineLeft, y });
      heights.set(id, rowHeight);
    });
    for (const attachment of attachments.filter((entry) => entry.stackId === stack.key && stack.machines.includes(entry.machineId))) {
      const machinePosition = positions.get(attachment.machineId);
      if (!machinePosition) continue;
      const rowHeight = heights.get(attachment.machineId) ?? NODE_HEIGHT;
      const connectedCenters = attachment.connectedPorts
        .map((entry) => {
          const position = positions.get(entry.machineId);
          if (!position) return undefined;
          return (
            position.y +
            (heights.get(entry.machineId) ?? NODE_HEIGHT) * entry.fraction
          );
        })
        .filter((value): value is number => value !== undefined);
      const rowCenter =
        connectedCenters.length > 0
          ? connectedCenters.reduce((sum, value) => sum + value, 0) /
            connectedCenters.length
          : machinePosition.y + rowHeight / 2;
      const x =
        attachment.side === 'left'
          ? machinePosition.x - CONTROL_GAP - CONTROL_SIZE -
            attachment.columnIndex * (CONTROL_SIZE + COLUMN_GAP)
          : machinePosition.x + NODE_WIDTH + CONTROL_GAP +
            attachment.columnIndex * (CONTROL_SIZE + COLUMN_GAP);
      const y =
        rowCenter -
        CONTROL_SIZE / 2 +
        (attachment.slotIndex - (attachment.slotCount - 1) / 2) * SLOT_PITCH;
      positions.set(attachment.controlId, { x, y });
      heights.set(attachment.controlId, CONTROL_SIZE);
    }
  }

  // Any attached control whose stack unit was not positioned (should not happen) falls back
  // to the unit position.
  for (const attachment of attachments) {
    if (positions.has(attachment.controlId)) continue;
    const stack = stackUnits.get(attachment.stackId);
    if (!stack) continue;
    const point = graph.node(stack.id);
    if (!point) continue;
    positions.set(attachment.controlId, {
      x: point.x - CONTROL_SIZE / 2,
      y: point.y - CONTROL_SIZE / 2,
    });
    heights.set(attachment.controlId, CONTROL_SIZE);
  }

  const unitOf = new Map<string, string>();
  for (const stack of stackList) {
    const uid = unitId(stack.key);
    for (const id of stack.machines) unitOf.set(id, uid);
    for (const attachment of attachments) {
      if (attachment.stackId === stack.key) unitOf.set(attachment.controlId, uid);
    }
  }
  for (const [id, uid] of controlUnits) unitOf.set(id, uid);

  return {
    visibleIds,
    hiddenCount,
    problemIds,
    edges,
    positions,
    heights,
    attachments,
    stackOf,
    unitOf,
    unitBounds,
  };
};

export type ControlSide = 'left' | 'right' | 'top' | 'bottom';

export const controlSideKey = (edgeId: string, controlId: string): string =>
  `${edgeId}\u0000${controlId}`;

export interface ControlSideRequest {
  key: string;
  controlId: string;
  controlCenter: { x: number; y: number };
  otherCenter: { x: number; y: number };
}

const CONTROL_SIDES: ControlSide[] = ['right', 'left', 'bottom', 'top'];
const SIDE_VECTORS: Record<ControlSide, { x: number; y: number }> = {
  right: { x: 1, y: 0 },
  left: { x: -1, y: 0 },
  bottom: { x: 0, y: 1 },
  top: { x: 0, y: -1 },
};

const sidePenalty = (request: ControlSideRequest, side: ControlSide): number => {
  const dx = request.otherCenter.x - request.controlCenter.x;
  const dy = request.otherCenter.y - request.controlCenter.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return 0.5;
  const vector = SIDE_VECTORS[side];
  return 1 - (dx * vector.x + dy * vector.y) / length;
};

export const assignControlSides = (
  requests: ControlSideRequest[],
): Map<string, ControlSide> => {
  const byControl = new Map<string, ControlSideRequest[]>();
  for (const request of requests) {
    const list = byControl.get(request.controlId) ?? [];
    list.push(request);
    byControl.set(request.controlId, list);
  }

  const result = new Map<string, ControlSide>();
  for (const [, list] of [...byControl.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pending = [...list].sort((a, b) => a.key.localeCompare(b.key));
    const available = new Set(CONTROL_SIDES);
    while (pending.length > 0 && available.size > 0) {
      let bestIndex = -1;
      let bestSide: ControlSide | undefined;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let index = 0; index < pending.length; index += 1) {
        for (const side of CONTROL_SIDES) {
          if (!available.has(side)) continue;
          const score = sidePenalty(pending[index], side);
          if (score < bestScore) {
            bestScore = score;
            bestIndex = index;
            bestSide = side;
          }
        }
      }
      if (!bestSide || bestIndex < 0) break;
      const request = pending.splice(bestIndex, 1)[0];
      result.set(request.key, bestSide);
      available.delete(bestSide);
    }
    for (const request of pending) {
      let bestSide = CONTROL_SIDES[0];
      let bestScore = Number.POSITIVE_INFINITY;
      for (const side of CONTROL_SIDES) {
        const score = sidePenalty(request, side);
        if (score < bestScore) {
          bestScore = score;
          bestSide = side;
        }
      }
      result.set(request.key, bestSide);
    }
  }
  return result;
};

interface Point {
  x: number;
  y: number;
}

export const sideAnchor = (center: Point, side: ControlSide): Point => {
  const offset = CONTROL_SIZE / 2;
  switch (side) {
    case 'left':
      return { x: center.x - offset, y: center.y };
    case 'right':
      return { x: center.x + offset, y: center.y };
    case 'top':
      return { x: center.x, y: center.y - offset };
    case 'bottom':
      return { x: center.x, y: center.y + offset };
  }
};

const controlSidePermutations = (count: number): ControlSide[][] => {
  const result: ControlSide[][] = [];
  const walk = (prefix: ControlSide[]) => {
    if (prefix.length === count) {
      result.push(prefix);
      return;
    }
    for (const side of CONTROL_SIDES) {
      if (prefix.includes(side)) continue;
      walk([...prefix, side]);
    }
  };
  walk([]);
  return result;
};

const orientation = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const segmentsCross = (a: Point, b: Point, c: Point, d: Point): boolean => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
    ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))
  );
};

export const optimizeControlSides = (
  line: SupplyLineModel,
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  heights: Map<string, number>,
  initialSides: Map<string, ControlSide>,
): Map<string, ControlSide> => {
  const sides = new Map(initialSides);
  const controls = Object.values(line.nodes)
    .filter((node) => node.type === 'control')
    .map((node) => node.id)
    .sort();

  const centerOf = (id: string): Point | undefined => {
    const node = line.nodes[id];
    const position = positions.get(id);
    if (!node || !position) return undefined;
    const width = node.type === 'control' ? CONTROL_SIZE : NODE_WIDTH;
    const height =
      heights.get(id) ?? (node.type === 'control' ? CONTROL_SIZE : NODE_HEIGHT);
    return { x: position.x + width / 2, y: position.y + height / 2 };
  };

  const anchorOf = (
    edge: GraphEdge,
    nodeId: string,
    role: 'from' | 'to',
    assigned: Map<string, ControlSide>,
  ): Point | undefined => {
    const node = line.nodes[nodeId];
    const position = positions.get(nodeId);
    if (!node || !position) return undefined;
    const height =
      heights.get(nodeId) ?? (node.type === 'control' ? CONTROL_SIZE : NODE_HEIGHT);
    if (node.type === 'control') {
      const center = centerOf(nodeId);
      if (!center) return undefined;
      const side = assigned.get(controlSideKey(edge.id, nodeId)) ?? (role === 'from' ? 'right' : 'left');
      return sideAnchor(center, side);
    }
    if (role === 'from') {
      const ports =
        node.type === 'source' || node.type === 'transformer' ? node.outputs : undefined;
      return {
        x: position.x + NODE_WIDTH,
        y: position.y + height * portFraction(ports, edge.itemId),
      };
    }
    const ports = node.type === 'transformer' ? node.inputs : undefined;
    return {
      x: position.x,
      y: position.y + height * portFraction(ports, edge.itemId),
    };
  };

  const segmentOf = (
    edge: GraphEdge,
    assigned: Map<string, ControlSide>,
  ): { a: Point; b: Point } | undefined => {
    const from = anchorOf(edge, edge.from, 'from', assigned);
    const to = anchorOf(edge, edge.to, 'to', assigned);
    return from && to ? { a: from, b: to } : undefined;
  };

  const countCrossings = (
    incident: GraphEdge[],
    fixed: Array<{ a: Point; b: Point }>,
    assigned: Map<string, ControlSide>,
  ): number => {
    const incidentSegments = incident
      .map((edge) => segmentOf(edge, assigned))
      .filter((segment): segment is { a: Point; b: Point } => segment !== undefined);
    let crossings = 0;
    for (const segment of incidentSegments) {
      for (const other of fixed) {
        if (segmentsCross(segment.a, segment.b, other.a, other.b)) crossings += 1;
      }
    }
    for (let i = 0; i < incidentSegments.length; i += 1) {
      for (let j = i + 1; j < incidentSegments.length; j += 1) {
        if (
          segmentsCross(
            incidentSegments[i].a,
            incidentSegments[i].b,
            incidentSegments[j].a,
            incidentSegments[j].b,
          )
        ) {
          crossings += 1;
        }
      }
    }
    return crossings;
  };

  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const controlId of controls) {
      const incident = edges.filter(
        (edge) => edge.from === controlId || edge.to === controlId,
      );
      if (incident.length < 2 || incident.length > CONTROL_SIDES.length) continue;
      const fixedEdges = edges.filter(
        (edge) => edge.from !== controlId && edge.to !== controlId,
      );
      const fixedSegments = fixedEdges
        .map((edge) => segmentOf(edge, sides))
        .filter((segment): segment is { a: Point; b: Point } => segment !== undefined);
      const controlCenter = centerOf(controlId);
      if (!controlCenter) continue;
      const endpoints = incident.map((edge) => {
        const otherId = edge.from === controlId ? edge.to : edge.from;
        const otherCenter = centerOf(otherId);
        return {
          edge,
          key: controlSideKey(edge.id, controlId),
          request: otherCenter
            ? { key: controlSideKey(edge.id, controlId), controlId, controlCenter, otherCenter }
            : undefined,
        };
      });
      if (endpoints.some((entry) => !sides.has(entry.key) || !entry.request)) continue;

      const preference = (permutation?: ControlSide[]) =>
        endpoints.reduce((sum, entry, index) => {
          const side =
            permutation?.[index] ?? sides.get(entry.key) ?? 'right';
          return sum + sidePenalty(entry.request!, side);
        }, 0);

      let bestCrossings = countCrossings(incident, fixedSegments, sides);
      let bestPreference = preference();
      let best: ControlSide[] | undefined;
      for (const permutation of controlSidePermutations(endpoints.length)) {
        const candidate = new Map(sides);
        endpoints.forEach((entry, index) => candidate.set(entry.key, permutation[index]));
        const crossings = countCrossings(incident, fixedSegments, candidate);
        const candidatePreference = preference(permutation);
        if (
          crossings < bestCrossings ||
          (crossings === bestCrossings && candidatePreference < bestPreference - 1e-9)
        ) {
          bestCrossings = crossings;
          bestPreference = candidatePreference;
          best = permutation;
        }
      }
      if (best) {
        endpoints.forEach((entry, index) => sides.set(entry.key, best[index]));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return sides;
};

export const respaceColumns = (
  layout: LayoutResult,
  demands: ColumnGapDemand[],
): {
  positions: Map<string, { x: number; y: number }>;
  unitShifts: Map<string, number>;
  shifted: boolean;
} => {
  const unitEntries = [...layout.unitBounds.entries()].sort(
    (a, b) => a[1].x + a[1].width / 2 - (b[1].x + b[1].width / 2),
  );
  const columns: Array<{
    center: number;
    left: number;
    right: number;
    units: string[];
  }> = [];
  for (const [unitIdValue, bounds] of unitEntries) {
    const center = bounds.x + bounds.width / 2;
    const current = columns[columns.length - 1];
    if (current && Math.abs(current.center - center) < 1) {
      current.units.push(unitIdValue);
      current.left = Math.min(current.left, bounds.x);
      current.right = Math.max(current.right, bounds.x + bounds.width);
    } else {
      columns.push({
        center,
        left: bounds.x,
        right: bounds.x + bounds.width,
        units: [unitIdValue],
      });
    }
  }
  if (columns.length < 2) {
    return { positions: new Map(layout.positions), unitShifts: new Map(), shifted: false };
  }
  const unitColumn = new Map<string, number>();
  columns.forEach((column, index) => {
    for (const unitIdValue of column.units) unitColumn.set(unitIdValue, index);
  });
  const requiredByGap = new Map<number, number>();
  for (const demand of demands) {
    const left = unitColumn.get(demand.leftUnitId);
    const right = unitColumn.get(demand.rightUnitId);
    if (left === undefined || right === undefined || left === right) continue;
    for (let gap = Math.min(left, right); gap < Math.max(left, right); gap += 1) {
      requiredByGap.set(gap, Math.max(requiredByGap.get(gap) ?? 0, demand.requiredGap));
    }
  }
  const shifts = [0];
  for (let gap = 0; gap < columns.length - 1; gap += 1) {
    const currentGap = columns[gap + 1].left - columns[gap].right;
    const required = requiredByGap.get(gap) ?? 0;
    const extra = Math.max(0, required - currentGap);
    shifts.push(shifts[gap] + extra);
  }
  if (shifts.every((shift) => shift === 0)) {
    return { positions: new Map(layout.positions), unitShifts: new Map(), shifted: false };
  }
  const unitShifts = new Map<string, number>();
  columns.forEach((column, index) => {
    for (const unitIdValue of column.units) unitShifts.set(unitIdValue, shifts[index] ?? 0);
  });
  const positions = new Map<string, { x: number; y: number }>();
  for (const [id, position] of layout.positions) {
    const unitIdValue = layout.unitOf.get(id);
    const column = unitIdValue ? unitColumn.get(unitIdValue) : undefined;
    const shift = column !== undefined ? shifts[column] ?? 0 : 0;
    positions.set(id, { x: position.x + shift, y: position.y });
  }
  return { positions, unitShifts, shifted: true };
};
