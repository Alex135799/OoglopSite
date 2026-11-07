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
export const CONTROL_GAP = 72;
export const COLUMN_GAP = 44;
export const SLOT_PITCH = 116;

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  itemId: string;
  expectedRate: number;
  actualRate: number;
  unknown: boolean;
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
          existing.expectedRate += port.expectedRate;
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
          continue;
        }
        merged.set(key, {
          id: key,
          from: node.id,
          to: nextId,
          itemId: port.itemId,
          expectedRate: port.expectedRate,
          actualRate: port.actualRate,
          unknown: port.unknown === true,
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

const portFraction = (
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
  for (const members of stacks.values()) members.sort();

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
  for (const unit of units) {
    const point = graph.node(unit.id);
    if (!point) continue;
    const left = point.x - unit.width / 2;
    const top = point.y - unit.height / 2;
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

  return {
    visibleIds,
    hiddenCount,
    problemIds,
    edges,
    positions,
    heights,
    attachments,
    stackOf,
  };
};
