import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type {
  Finding,
  Severity,
  SplitterNode,
  SupplyLineModel,
  SupplyNode,
  SupplyOutputPort,
} from '../domain/types';
import { formatNumber } from '../format';
import { productionBoostMultiplier } from '../domain/rateMath';
import {
  assignControlSides,
  controlSideKey,
  layoutSupplyGraph,
  optimizeControlSides,
  portFraction,
  respaceColumns,
  type ControlSideRequest,
  type GraphEdge,
  type MachineAttachment,
} from './lineGraphLayout';
import { routeEdges } from './edgeRouting';
import { assignGroupRows, buildProductionGroups, type ProductionGroup } from './productionLayout';
import { detectCrossingPairs, type CrossingSegment } from './tierCrossings';
import { plannerColors, usePlannerColors, type PlannerModeColors } from '../theme';

interface BuildingNodeData {
  label: string;
  subtitle: string;
  clock: number;
  boost: number;
  severity?: Severity;
  inputItems?: string[];
  outputItems?: string[];
  [key: string]: unknown;
}

interface TransportNodeData {
  label: 'S' | 'M' | 'T' | 'J';
  kind: 'splitter' | 'merger' | 'storage' | 'junction' | 'tank';
  severity?: Severity;
  bottleneck?: boolean;
  [key: string]: unknown;
}

const severityOrder: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const severityOf = (buildingId: string, findings: Finding[]): Severity | undefined => {
  let result: Severity | undefined;
  for (const finding of findings) {
    if (!finding.buildingIds?.includes(buildingId)) continue;
    if (!result || severityOrder[finding.severity] < severityOrder[result]) {
      result = finding.severity;
    }
  }
  return result;
};

const nodeSeverity = (severity: Severity | undefined, colors: PlannerModeColors) => {
  switch (severity) {
    case 'critical':
      return { border: plannerColors.critical.color, background: colors.criticalSurface };
    case 'warning':
      return { border: plannerColors.warning.color, background: colors.warningSurface };
    case 'info':
      return { border: plannerColors.info.color, background: colors.surface };
    default:
      return { border: colors.neutral, background: colors.surface };
  }
};

const BuildingNode = ({ data, selected }: NodeProps) => {
  const node = data as unknown as BuildingNodeData;
  const modeColors = usePlannerColors();
  const colors = nodeSeverity(node.severity, modeColors);
  const boostMultiplier = productionBoostMultiplier(node.boost);
  const boosted = boostMultiplier > 1;
  const glow = boosted
    ? `0 0 16px 2px ${plannerColors.somersloop.glow}`
    : undefined;
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: boosted ? 0.15 : 0.3,
        width: 220,
        height: '100%',
        p: '0.55rem 0.7rem',
        border: '2px solid',
        borderColor: colors.border,
        borderRadius: '0.45rem',
        bgcolor: colors.background,
        boxShadow: [
          selected ? `0 0 0 3px ${plannerColors.primary.color}` : undefined,
          glow,
          `0 1px 3px ${modeColors.shadowStrong}`,
        ]
          .filter(Boolean)
          .join(', '),
        fontSize: '0.8rem',
        lineHeight: 1.2,
        '& strong': {
          overflow: 'hidden',
          fontSize: '0.85rem',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
        '& .planner-graph-meta': {
          overflow: 'hidden',
          color: modeColors.textMuted,
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      }}
    >
      {(node.inputItems ?? []).map((itemId, index, items) => (
        <Handle
          key={itemId}
          id={`in-${itemId}`}
          type="target"
          position={Position.Left}
          isConnectable={false}
          style={{ top: `${((index + 1) / (items.length + 1)) * 100}%` }}
        />
      ))}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {(node.outputItems ?? []).map((itemId, index, items) => (
        <Handle
          key={itemId}
          id={`out-${itemId}`}
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={{ top: `${((index + 1) / (items.length + 1)) * 100}%` }}
        />
      ))}
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <strong>{node.label}</strong>
      <Box component="span" className="planner-graph-meta">{node.subtitle}</Box>
      <Box component="span" className="planner-graph-meta">
        Clock {Math.round(node.clock * 100)}%
      </Box>
      {boosted && (
        <Box
          component="span"
          sx={{ color: plannerColors.somersloop.color, fontWeight: 600 }}
        >
          Boost +{Math.round((boostMultiplier - 1) * 100)}%
        </Box>
      )}
    </Box>
  );
};

const TransportNodeShape = ({ data, selected }: NodeProps) => {
  const transport = data as unknown as TransportNodeData;
  const modeColors = usePlannerColors();
  const severity = transport.severity ?? (transport.bottleneck ? 'warning' : undefined);
  const colors = nodeSeverity(severity, modeColors);
  return (
    <Box
      aria-label={`${
        transport.kind === 'merger'
          ? 'Merger'
          : transport.kind === 'storage'
            ? 'Storage'
            : transport.kind === 'junction'
              ? 'Pipeline Junction'
              : transport.kind === 'tank'
                ? 'Fluid Storage'
                : 'Splitter'
      }${transport.bottleneck ? ' (bottleneck)' : ''}`}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 44,
        height: 44,
        fontWeight: 700,
        fontSize: '0.9rem',
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          transform: 'rotate(45deg)',
          border: '2px solid',
          borderColor: colors.border,
          borderRadius: '4px',
          bgcolor: colors.background,
          boxShadow: selected
            ? `0 0 0 3px ${plannerColors.primary.color}`
            : severity
              ? `0 0 0 2px ${colors.border}`
              : `0 1px 3px ${modeColors.shadowStrong}`,
        }}
      />
      <Box component="span" sx={{ position: 'relative', color: modeColors.textPrimary }}>
        {transport.label}
      </Box>
      <Handle type="target" position={Position.Left} id="in-left" isConnectable={false} />
      <Handle type="source" position={Position.Left} id="out-left" isConnectable={false} />
      <Handle type="target" position={Position.Right} id="in-right" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="out-right" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="in-top" isConnectable={false} />
      <Handle type="source" position={Position.Top} id="out-top" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="in-bottom" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" isConnectable={false} />
    </Box>
  );
};

const nodeTypes = { building: BuildingNode, transport: TransportNodeShape };

interface GraphObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LaneEdgeData {
  centerX?: number;
  centerY?: number;
  label?: string;
  obstacles?: GraphObstacle[];
  [key: string]: unknown;
}

const LaneEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: EdgeProps) => {
  const lane = data as unknown as LaneEdgeData;
  const modeColors = usePlannerColors();
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    centerX: lane.centerX ?? (sourceX + targetX) / 2,
    centerY: lane.centerY ?? (sourceY + targetY) / 2,
  });
  const labelWidth = Math.max(18, (lane.label?.length ?? 0) * 6.5 + 8);
  const labelHeight = 18;
  const labelClearance = 12;
  const isClear = (x: number, y: number) => {
    const left = x - labelWidth / 2;
    const right = x + labelWidth / 2;
    const top = y - labelHeight / 2;
    const bottom = y + labelHeight / 2;
    return !(lane.obstacles ?? []).some(
      (obstacle) =>
        right > obstacle.x - labelClearance &&
        left < obstacle.x + obstacle.width + labelClearance &&
        bottom > obstacle.y - labelClearance &&
        top < obstacle.y + obstacle.height + labelClearance,
    );
  };
  const labelPosition = (() => {
    if (!lane.label) return undefined;
    if (typeof document === 'undefined') {
      return isClear(labelX, labelY) ? { x: labelX, y: labelY } : undefined;
    }
    const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    probe.setAttribute('d', path);
    const total = typeof probe.getTotalLength === 'function' ? probe.getTotalLength() : 0;
    if (!Number.isFinite(total) || total <= 0 || typeof probe.getPointAtLength !== 'function') {
      return isClear(labelX, labelY) ? { x: labelX, y: labelY } : undefined;
    }
    const midpoint = total / 2;
    const reach = Math.max(0, total / 2 - 12);
    for (let step = 0; step <= 16; step += 1) {
      const distance = (step / 16) * reach;
      const directions = step === 0 ? [0] : [-1, 1];
      for (const direction of directions) {
        const point = probe.getPointAtLength(midpoint + direction * distance);
        if (isClear(point.x, point.y)) return point;
      }
    }
    return undefined;
  })();
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      {labelPosition ? <EdgeLabelRenderer>
        <Box
          sx={{
            position: 'absolute',
            zIndex: 1000,
            transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
            pointerEvents: 'none',
            bgcolor: modeColors.surface,
            color: modeColors.textSecondary,
            border: `1px solid ${modeColors.border}`,
            fontSize: 11,
            px: 0.5,
            py: 0.15,
            borderRadius: 0.5,
            whiteSpace: 'nowrap',
          }}
        >
          {lane.label}
        </Box>
      </EdgeLabelRenderer> : null}
    </>
  );
};

const edgeTypes = { lane: LaneEdge };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 86;
const SPLITTER_SIZE = 44;
const STACK_GAP = 16;
const MAX_NODES = 150;

const CHAIN_HORIZONTAL_GAP = 160;
const CHAIN_GAP = NODE_HEIGHT + STACK_GAP;

const alignStorageToConsumers = (
  nodes: Node[],
  line: SupplyLineModel,
  edges: GraphEdge[],
  heights: Map<string, number>,
): Node[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge);
    outgoing.set(edge.from, list);
  }
  const sizeOf = (id: string) => {
    const node = line.nodes[id];
    return {
      width: node?.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH,
      height: heights.get(id) ?? (node?.type === 'control' ? SPLITTER_SIZE : NODE_HEIGHT),
    };
  };
  const targetPointY = (id: string, itemId: string) => {
    const node = line.nodes[id];
    const position = byId.get(id);
    if (!node || !position) return undefined;
    const size = sizeOf(id);
    if (node.type === 'transformer') {
      return position.position.y + size.height * portFraction(node.inputs, itemId);
    }
    if (node.type === 'control') {
      return position.position.y + size.height / 2;
    }
    return position.position.y + size.height / 2;
  };
  for (const storage of Object.values(line.nodes)) {
    if (
      storage.type !== 'control' ||
      (storage.kind !== 'storage' && storage.kind !== 'tank')
    ) {
      continue;
    }
    const storageNode = byId.get(storage.id);
    if (!storageNode) continue;
    const consumerEdges = outgoing.get(storage.id) ?? [];
    const consumers = [...new Set(consumerEdges.map((edge) => edge.to))]
      .map((id) => byId.get(id))
      .filter((node): node is Node => Boolean(node));
    if (consumers.length === 0) continue;
    const connectionYs = consumerEdges
      .map((edge) => targetPointY(edge.to, edge.itemId))
      .filter((value): value is number => value !== undefined);
    if (connectionYs.length === 0) continue;
    const storageSize = sizeOf(storage.id);
    const targetLeft = Math.min(
      ...consumers.map((consumer) => consumer.position.x),
    );
    const targetCenterY =
      connectionYs.reduce((sum, value) => sum + value, 0) / connectionYs.length;
    storageNode.position = {
      x: targetLeft - 60 - storageSize.width,
      y: targetCenterY - storageSize.height / 2,
    };
  }
  return nodes;
};

const applyProductionGrid = (
  nodes: Node[],
  line: SupplyLineModel,
  edges: GraphEdge[],
  attachments: MachineAttachment[],
  heights: Map<string, number>,
): Node[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const groups = buildProductionGroups(line, edges);
  if (groups.length === 0) return nodes;
  const rows = assignGroupRows(groups);
  const groupByBuilding = new Map<string, ProductionGroup>();
  for (const group of groups) {
    for (const id of group.buildingIds) groupByBuilding.set(id, group);
  }
  const attachedControlByGroup = new Map<string, string[]>();
  for (const attachment of attachments) {
    const group = groupByBuilding.get(attachment.machineId);
    if (!group) continue;
    const list = attachedControlByGroup.get(group.id) ?? [];
    list.push(attachment.controlId);
    attachedControlByGroup.set(group.id, list);
  }
  const attachedControls = new Set(
    attachments.map((attachment) => attachment.controlId),
  );

  interface Cell {
    id: string;
    kind: 'group' | 'control';
    tier: number;
    row: number;
    nodeIds: string[];
    width: number;
    height: number;
    left: number;
    top: number;
    columnKey: string;
  }

  const boundsFor = (ids: string[]) => {
    const placed = ids.map((id) => byId.get(id)).filter((node): node is Node => Boolean(node));
    if (placed.length === 0) return undefined;
    const left = Math.min(...placed.map((node) => node.position.x));
    const top = Math.min(...placed.map((node) => node.position.y));
    const right = Math.max(
      ...placed.map((node) =>
        node.position.x +
        (line.nodes[node.id]?.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH),
      ),
    );
    const bottom = Math.max(
      ...placed.map((node) => node.position.y + (heights.get(node.id) ?? NODE_HEIGHT)),
    );
    return { left, top, width: right - left, height: bottom - top };
  };

  for (const group of groups) {
    const sourceIds = group.buildingIds.filter(
      (id) => line.nodes[id]?.type === 'source' && byId.has(id),
    );
    if (sourceIds.length < 2) continue;
    const first = byId.get(sourceIds[0])!;
    const minY = Math.min(...sourceIds.map((id) => byId.get(id)!.position.y));
    const x = Math.min(...sourceIds.map((id) => byId.get(id)!.position.x));
    let nextY = minY;
    for (const id of sourceIds.sort()) {
      const node = byId.get(id)!;
      node.position = { x, y: nextY };
      nextY += (heights.get(id) ?? NODE_HEIGHT) + STACK_GAP;
    }
    void first;
  }

  const outgoingByNode = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoingByNode.get(edge.from) ?? [];
    list.push(edge);
    outgoingByNode.set(edge.from, list);
  }
  const consumerGroupsByItem = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const buildingId of group.buildingIds) {
      const building = line.nodes[buildingId];
      if (building?.type !== 'transformer') continue;
      for (const port of building.inputs) {
        const set = consumerGroupsByItem.get(port.itemId) ?? new Set<string>();
        set.add(group.id);
        consumerGroupsByItem.set(port.itemId, set);
      }
    }
  }
  const sinkStorageByGroup = new Map<string, string[]>();
  const sinkStorageIds = new Set<string>();
  for (const node of Object.values(line.nodes)) {
    if (
      node.type !== 'control' ||
      (node.kind !== 'storage' && node.kind !== 'tank') ||
      (outgoingByNode.get(node.id)?.length ?? 0) > 0 ||
      !node.itemId
    ) {
      continue;
    }
    const candidateIds = [...(consumerGroupsByItem.get(node.itemId) ?? [])];
    const candidateGroups = candidateIds
      .map((id) => groups.find((group) => group.id === id))
      .filter((group): group is ProductionGroup => Boolean(group))
      .sort((a, b) => b.tier - a.tier || a.key.localeCompare(b.key));
    const consumerGroup = candidateGroups[0];
    if (!consumerGroup) continue;
    const list = sinkStorageByGroup.get(consumerGroup.id) ?? [];
    list.push(node.id);
    sinkStorageByGroup.set(consumerGroup.id, list);
    sinkStorageIds.add(node.id);
  }

  for (const [groupId, storageIds] of sinkStorageByGroup) {
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) continue;
    const machineNodes = group.buildingIds
      .map((id) => byId.get(id))
      .filter((node): node is Node => Boolean(node));
    if (machineNodes.length === 0) continue;
    const x = Math.min(...machineNodes.map((node) => node.position.x));
    let nextY =
      Math.max(
        ...machineNodes.map(
          (node) =>
            node.position.y + (heights.get(node.id) ?? NODE_HEIGHT),
        ),
      ) + STACK_GAP;
    for (const id of storageIds.sort()) {
      const node = byId.get(id);
      if (!node) continue;
      const height = heights.get(id) ?? SPLITTER_SIZE;
      node.position = { x, y: nextY };
      nextY += height + STACK_GAP;
    }
  }

  const storageGroupById = new Map<string, string>();
  for (const [groupId, storageIds] of sinkStorageByGroup) {
    for (const storageId of storageIds) storageGroupById.set(storageId, groupId);
  }
  const storageAttachmentByGroup = new Map<string, Set<string>>();
  const storageAttachedControls = new Set<string>();
  const storageAttachmentTargets = new Map<string, { targetId: string; side: 'left' | 'right' }[]>();
  const isAttachableControl = (id: string) => {
    const node = line.nodes[id];
    return (
      node?.type === 'control' &&
      (node.kind === 'splitter' || node.kind === 'merger' || node.kind === 'junction')
    );
  };
  const addStorageAttachment = (
    controlId: string,
    targetId: string,
    side: 'left' | 'right',
  ) => {
    const groupId = storageGroupById.get(targetId);
    if (!groupId) return;
    const list = storageAttachmentTargets.get(controlId) ?? [];
    list.push({ targetId, side });
    storageAttachmentTargets.set(controlId, list);
    storageAttachedControls.add(controlId);
    const attached = storageAttachmentByGroup.get(groupId) ?? new Set<string>();
    attached.add(controlId);
    storageAttachmentByGroup.set(groupId, attached);
  };
  for (const edge of edges) {
    const from = line.nodes[edge.from];
    const to = line.nodes[edge.to];
    if (isAttachableControl(edge.from) && to?.type === 'control' && (to.kind === 'storage' || to.kind === 'tank')) {
      addStorageAttachment(edge.from, edge.to, 'left');
    } else if (isAttachableControl(edge.to) && from?.type === 'control' && (from.kind === 'storage' || from.kind === 'tank')) {
      addStorageAttachment(edge.to, edge.from, 'right');
    }
  }
  for (const controlId of storageAttachedControls) {
    const targets = storageAttachmentTargets.get(controlId) ?? [];
    const targetNodes = targets
      .map((entry) => byId.get(entry.targetId))
      .filter((node): node is Node => Boolean(node));
    if (targetNodes.length === 0) continue;
    const side = targets[0]?.side ?? 'left';
    const centerY =
      targetNodes.reduce((sum, target) => {
        return sum + target.position.y + (heights.get(target.id) ?? SPLITTER_SIZE) / 2;
      }, 0) / targetNodes.length;
    const controlNode = byId.get(controlId);
    if (!controlNode) continue;
    const controlHeight = heights.get(controlId) ?? SPLITTER_SIZE;
    if (side === 'left') {
      controlNode.position = {
        x: Math.min(...targetNodes.map((target) => target.position.x)) - 60 - SPLITTER_SIZE,
        y: centerY - controlHeight / 2,
      };
    } else {
      controlNode.position = {
        x: Math.max(...targetNodes.map((target) => target.position.x + SPLITTER_SIZE)) + 60,
        y: centerY - controlHeight / 2,
      };
    }
  }

  const cells: Cell[] = groups.flatMap((group) => {
    const nodeIds = [
      ...group.buildingIds,
      ...(attachedControlByGroup.get(group.id) ?? []),
      ...(sinkStorageByGroup.get(group.id) ?? []),
      ...(storageAttachmentByGroup.get(group.id) ?? []),
    ].filter((id) => byId.has(id));
    if (nodeIds.length === 0) return [];
    const bounds = boundsFor(nodeIds);
    if (!bounds) return [];
    return [{
      id: group.id,
      kind: 'group' as const,
      tier: group.tier,
      row: rows.get(group.id) ?? group.tier,
      nodeIds,
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
      columnKey: `tier:${group.tier}`,
    }];
  });

  const controlIds = Object.values(line.nodes)
    .filter(
      (node) =>
        node.type === 'control' &&
        byId.has(node.id) &&
        !attachedControls.has(node.id) &&
        !sinkStorageIds.has(node.id) &&
        !storageAttachedControls.has(node.id),
    )
    .map((node) => node.id);
  const incomingEdges = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = incomingEdges.get(edge.to) ?? [];
    list.push(edge);
    incomingEdges.set(edge.to, list);
  }
  const upstreamGroupsCache = new Map<string, Set<string>>();
  const upstreamGroupsOfControl = (
    id: string,
    visiting = new Set<string>(),
  ): Set<string> => {
    const cached = upstreamGroupsCache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set();
    const nextVisiting = new Set(visiting).add(id);
    const result = new Set<string>();
    for (const edge of incomingEdges.get(id) ?? []) {
      const group = groupByBuilding.get(edge.from);
      if (group) result.add(group.id);
      else if (line.nodes[edge.from]?.type === 'control') {
        for (const groupId of upstreamGroupsOfControl(edge.from, nextVisiting)) {
          result.add(groupId);
        }
      }
    }
    upstreamGroupsCache.set(id, result);
    return result;
  };
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const outgoingEdges = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const list = outgoingEdges.get(edge.from) ?? [];
    list.push(edge);
    outgoingEdges.set(edge.from, list);
  }
  const downstreamGroupsCache = new Map<string, Set<string>>();
  const downstreamGroupsOfControl = (
    id: string,
    visiting = new Set<string>(),
  ): Set<string> => {
    const cached = downstreamGroupsCache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return new Set();
    const nextVisiting = new Set(visiting).add(id);
    const result = new Set<string>();
    for (const edge of outgoingEdges.get(id) ?? []) {
      const group = groupByBuilding.get(edge.to);
      if (group) result.add(group.id);
      else if (line.nodes[edge.to]?.type === 'control') {
        for (const groupId of downstreamGroupsOfControl(edge.to, nextVisiting)) {
          result.add(groupId);
        }
      }
    }
    downstreamGroupsCache.set(id, result);
    return result;
  };
  const itemConsumerGroups = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const buildingId of group.buildingIds) {
      const building = line.nodes[buildingId];
      if (building?.type !== 'transformer') continue;
      for (const port of building.inputs) {
        const set = itemConsumerGroups.get(port.itemId) ?? new Set<string>();
        set.add(group.id);
        itemConsumerGroups.set(port.itemId, set);
      }
    }
  }
  const controlLevels = new Map<string, { key: string; boundary: number; sublevel: number }>();
  const levelOfControl = (id: string, visiting = new Set<string>()): { key: string; boundary: number; sublevel: number } => {
    const cached = controlLevels.get(id);
    if (cached) return cached;
    if (visiting.has(id)) {
      const fallback = { key: '0:0', boundary: 0, sublevel: 0 };
      controlLevels.set(id, fallback);
      return fallback;
    }
    const nextVisiting = new Set(visiting).add(id);
    const controlNode = line.nodes[id];
    if (
      controlNode?.type === 'control' &&
      (controlNode.kind === 'storage' || controlNode.kind === 'tank') &&
      downstreamGroupsOfControl(id).size === 0
    ) {
      const consumers = controlNode.itemId
        ? [...(itemConsumerGroups.get(controlNode.itemId) ?? [])]
        : [];
      const consumerTiers = consumers
        .map((groupId) => groupById.get(groupId)?.tier)
        .filter((tier): tier is number => tier !== undefined);
      if (consumerTiers.length > 0) {
        const boundary = Math.max(...consumerTiers);
        const level = { key: `${boundary}:0`, boundary, sublevel: 0 };
        controlLevels.set(id, level);
        return level;
      }
    }
    const directInputTiers = (incomingEdges.get(id) ?? [])
      .map((edge) => groupByBuilding.get(edge.from)?.tier)
      .filter((tier): tier is number => tier !== undefined);
    const directOutputTiers = (outgoingEdges.get(id) ?? [])
      .map((edge) => groupByBuilding.get(edge.to)?.tier)
      .filter((tier): tier is number => tier !== undefined);
    let boundary: number;
    let sublevel: number;
    if (directInputTiers.length > 0) {
      boundary = Math.max(...directInputTiers);
      sublevel = 0;
    } else if (directOutputTiers.length > 0) {
      boundary = Math.max(0, Math.min(...directOutputTiers) - 1);
      sublevel = 1;
    } else {
      const upstreamLevels = (incomingEdges.get(id) ?? [])
        .filter((edge) => line.nodes[edge.from]?.type === 'control')
        .map((edge) => levelOfControl(edge.from, nextVisiting));
      if (upstreamLevels.length > 0) {
        boundary = Math.max(...upstreamLevels.map((level) => level.boundary));
        sublevel = Math.max(...upstreamLevels.map((level) => level.sublevel)) + 1;
      } else {
        boundary = 0;
        sublevel = 0;
      }
    }
    const level = { key: `${boundary}:${sublevel}`, boundary, sublevel };
    controlLevels.set(id, level);
    return level;
  };
  for (const id of controlIds) levelOfControl(id);

  const controlAdjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!controlIds.includes(edge.from) || !controlIds.includes(edge.to)) continue;
    if (controlLevels.get(edge.from)?.key !== controlLevels.get(edge.to)?.key) continue;
    const forward = controlAdjacency.get(edge.from) ?? new Set<string>();
    forward.add(edge.to);
    controlAdjacency.set(edge.from, forward);
    const reverse = controlAdjacency.get(edge.to) ?? new Set<string>();
    reverse.add(edge.from);
    controlAdjacency.set(edge.to, reverse);
  }
  const controlClusters: string[][] = [];
  const seenControls = new Set<string>();
  for (const id of controlIds) {
    if (seenControls.has(id)) continue;
    const queue = [id];
    const cluster: string[] = [];
    seenControls.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      cluster.push(current);
      for (const next of controlAdjacency.get(current) ?? []) {
        if (seenControls.has(next)) continue;
        seenControls.add(next);
        queue.push(next);
      }
    }
    controlClusters.push(cluster);
  }
  const controlCells: Cell[] = [];
  const usedControlRows = new Map<string, Set<number>>();
  for (const cluster of controlClusters) {
    const connectedGroups = new Set<string>();
    const level = controlLevels.get(cluster[0]) ?? { key: '0:0', boundary: 0, sublevel: 0 };
    for (const id of cluster) {
      const control = line.nodes[id];
      const isSinkStorage =
        control?.type === 'control' &&
        (control.kind === 'storage' || control.kind === 'tank') &&
        downstreamGroupsOfControl(id).size === 0;
      if (isSinkStorage && control.itemId) {
        for (const groupId of itemConsumerGroups.get(control.itemId) ?? []) {
          connectedGroups.add(groupId);
        }
        continue;
      }
      for (const groupId of upstreamGroupsOfControl(id)) connectedGroups.add(groupId);
      for (const groupId of downstreamGroupsOfControl(id)) connectedGroups.add(groupId);
    }
    const groupRows = [...connectedGroups]
      .map((id) => rows.get(id))
      .filter((value): value is number => value !== undefined);
    const desiredRow =
      groupRows.length > 0
        ? groupRows.reduce((sum, value) => sum + value, 0) / groupRows.length
        : cells.length;
    const used = usedControlRows.get(level.key) ?? new Set<number>();
    usedControlRows.set(level.key, used);
    let row = Math.max(0, Math.round(desiredRow));
    let offset = 0;
    while (used.has(row)) {
      offset += 1;
      row = Math.max(0, Math.round(desiredRow) + offset);
    }
    used.add(row);
    const bounds = boundsFor(cluster);
    if (!bounds) continue;
    controlCells.push({
      id: `control:${cluster[0]}`,
      kind: 'control',
      tier: level.boundary,
      row,
      nodeIds: cluster,
      width: bounds.width,
      height: bounds.height,
      left: bounds.left,
      top: bounds.top,
      columnKey: `control:${level.key}`,
    });
  }

  const allCells = [...cells, ...controlCells];
  const tierWidths = new Map<number, number>();
  const controlWidths = new Map<string, number>();
  const levelsByBoundary = new Map<number, Array<{ key: string; boundary: number; sublevel: number }>>();
  for (const cell of cells) {
    tierWidths.set(cell.tier, Math.max(tierWidths.get(cell.tier) ?? 0, cell.width));
  }
  for (const level of controlLevels.values()) {
    const list = levelsByBoundary.get(level.boundary) ?? [];
    if (!list.some((entry) => entry.key === level.key)) list.push(level);
    levelsByBoundary.set(level.boundary, list);
  }
  for (const level of controlLevels.values()) {
    const width = Math.max(
      ...controlCells
        .filter((cell) => cell.columnKey === `control:${level.key}`)
        .map((cell) => cell.width),
      0,
    );
    controlWidths.set(level.key, Math.max(controlWidths.get(level.key) ?? 0, width));
  }
  const maxTier = Math.max(
    ...[...tierWidths.keys(), ...levelsByBoundary.keys(), 0],
  );
  const columnX = new Map<string, number>();
  let x = Math.min(...allCells.map((cell) => cell.left));
  for (let tier = 0; tier <= maxTier; tier += 1) {
    columnX.set(`tier:${tier}`, x);
    x += (tierWidths.get(tier) ?? 0) + 100;
    const levels = (levelsByBoundary.get(tier) ?? []).sort(
      (a, b) => a.sublevel - b.sublevel,
    );
    for (const level of levels) {
      columnX.set(`control:${level.key}`, x);
      x += (controlWidths.get(level.key) ?? 0) + 100;
    }
  }
  const initialPositions = new Map(
    nodes.map((node) => [node.id, { ...node.position }]),
  );
  const rowOfNode = new Map<string, number>();
  for (const cell of allCells) {
    for (const id of cell.nodeIds) rowOfNode.set(id, cell.row);
  }

  const relayout = (gapExtra = new Map<number, number>()) => {
    const rowHeight = new Map<number, number>();
    for (const cell of allCells) {
      rowHeight.set(cell.row, Math.max(rowHeight.get(cell.row) ?? 0, cell.height));
    }
    const sortedRows = [...rowHeight.keys()].sort((a, b) => a - b);
    const rowTop = new Map<number, number>();
    let y = Math.min(...allCells.map((cell) => cell.top));
    for (const row of sortedRows) {
      y += gapExtra.get(row) ?? 0;
      rowTop.set(row, y);
      y += (rowHeight.get(row) ?? 0) + 60;
    }
    for (const node of nodes) {
      const initial = initialPositions.get(node.id);
      if (initial) node.position = { ...initial };
    }
    for (const cell of allCells) {
      const targetX = columnX.get(cell.columnKey);
      const targetRow = rowTop.get(cell.row);
      if (targetX === undefined || targetRow === undefined) continue;
      const targetY =
        targetRow +
        ((rowHeight.get(cell.row) ?? cell.height) - cell.height) / 2;
      const dx = targetX - cell.left;
      const dy = targetY - cell.top;
      for (const id of cell.nodeIds) {
        const node = byId.get(id);
        if (!node) continue;
        node.position = {
          x: node.position.x + dx,
          y: node.position.y + dy,
        };
      }
    }
  };

  const portFractionFor = (
    ports: Array<{ itemId: string }> | undefined,
    itemId: string,
  ) => {
    const items = [...new Set((ports ?? []).map((port) => port.itemId))];
    const index = items.indexOf(itemId);
    return index < 0 ? 0.5 : (index + 1) / (items.length + 1);
  };
  const crossingSegments = (): CrossingSegment[] =>
    edges.flatMap((edge) => {
      const from = line.nodes[edge.from];
      const to = line.nodes[edge.to];
      const fromNode = byId.get(edge.from);
      const toNode = byId.get(edge.to);
      if (!from || !to || !fromNode || !toNode) return [];
      const fromSize = {
        width: from.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH,
        height: heights.get(edge.from) ?? (from.type === 'control' ? SPLITTER_SIZE : NODE_HEIGHT),
      };
      const toSize = {
        width: to.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH,
        height: heights.get(edge.to) ?? (to.type === 'control' ? SPLITTER_SIZE : NODE_HEIGHT),
      };
      const a =
        from.type === 'control'
          ? {
              x: fromNode.position.x + fromSize.width / 2,
              y: fromNode.position.y + fromSize.height / 2,
            }
          : {
              x: fromNode.position.x + fromSize.width,
              y:
                fromNode.position.y +
                fromSize.height *
                  portFractionFor(
                    from.type === 'source' || from.type === 'transformer'
                      ? from.outputs
                      : undefined,
                    edge.itemId,
                  ),
            };
      const b =
        to.type === 'control'
          ? {
              x: toNode.position.x + toSize.width / 2,
              y: toNode.position.y + toSize.height / 2,
            }
          : {
              x: toNode.position.x,
              y:
                toNode.position.y +
                toSize.height *
                  portFractionFor(
                    to.type === 'transformer' ? to.inputs : undefined,
                    edge.itemId,
                  ),
            };
      return [{ id: edge.id, a, b }];
    });

  const countCrossings = () => detectCrossingPairs(crossingSegments()).length;
  relayout();
  let bestCrossings = countCrossings();

  const groupCellsByTier = new Map<number, Cell[]>();
  for (const cell of cells) {
    const list = groupCellsByTier.get(cell.tier) ?? [];
    list.push(cell);
    groupCellsByTier.set(cell.tier, list);
  }
  for (const tierCells of groupCellsByTier.values()) {
    tierCells.sort((a, b) => a.row - b.row);
    for (let index = 0; index + 1 < tierCells.length; index += 1) {
      const first = tierCells[index];
      const second = tierCells[index + 1];
      const rowA = first.row;
      const rowB = second.row;
      first.row = rowB;
      second.row = rowA;
      relayout();
      const crossings = countCrossings();
      if (crossings < bestCrossings) {
        bestCrossings = crossings;
      } else {
        first.row = rowA;
        second.row = rowB;
      }
    }
  }
  relayout();
  rowOfNode.clear();
  for (const cell of allCells) {
    for (const id of cell.nodeIds) rowOfNode.set(id, cell.row);
  }

  const gapExtra = new Map<number, number>();
  for (const crossing of detectCrossingPairs(crossingSegments())) {
    const edgeA = edges.find((edge) => edge.id === crossing.a);
    const edgeB = edges.find((edge) => edge.id === crossing.b);
    if (!edgeA || !edgeB) continue;
    for (const row of new Set([
      rowOfNode.get(edgeA.to),
      rowOfNode.get(edgeB.to),
    ])) {
      if (row === undefined) continue;
      gapExtra.set(row, Math.min(160, (gapExtra.get(row) ?? 0) + 32));
    }
  }
  relayout(gapExtra);
  return nodes;
};

const layoutTransportChains = (
  nodes: Node[],
  transportNodes: SplitterNode[],
): Node[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const transportById = new Map(transportNodes.map((node) => [node.id, node]));
  const transportIds = new Set(transportById.keys());

  const inputRoles = (transport: SplitterNode) =>
    transport.inputRoles ??
    (transport.directInputs ?? transport.inputs).map((id) => ({
      id,
      role: transportIds.has(id) ? ('continuation' as const) : ('sink' as const),
    }));
  const outputRoles = (transport: SplitterNode) =>
    transport.outputRoles ??
    (transport.directOutputs ?? transport.outputs).map((id) => ({
      id,
      role: transportIds.has(id) ? ('continuation' as const) : ('tap' as const),
    }));

  const continuationOut = (transport: SplitterNode) =>
    outputRoles(transport)
      .filter((role) => role.role === 'continuation' && byId.has(role.id))
      .map((role) => role.id);
  const continuationIn = (transport: SplitterNode) =>
    inputRoles(transport)
      .filter((role) => role.role === 'continuation' && byId.has(role.id))
      .map((role) => role.id);
  const taps = (transport: SplitterNode) =>
    outputRoles(transport)
      .filter((role) => role.role === 'tap' && byId.has(role.id))
      .map((role) => role.id);
  const sinks = (transport: SplitterNode) =>
    inputRoles(transport)
      .filter((role) => role.role === 'sink' && byId.has(role.id))
      .map((role) => role.id);

  const visited = new Set<string>();
  for (const start of transportNodes) {
    if (!byId.has(start.id) || visited.has(start.id)) continue;
    if (continuationIn(start).length > 0) continue;

    const chain: SplitterNode[] = [];
    let current: SplitterNode | undefined = start;
    while (current && !visited.has(current.id)) {
      if (continuationOut(current).length > 1) break;
      if (continuationIn(current).length > 1) break;
      if (taps(current).length > 1 && continuationOut(current).length > 0) break;
      chain.push(current);
      visited.add(current.id);
      const nextId: string | undefined = continuationOut(current)[0];
      current = nextId ? transportById.get(nextId) : undefined;
    }
    if (chain.length === 0) continue;
    const isMerger = chain[0].kind === 'merger';
    const isJunctionChain = chain[0].kind === 'junction';

    const tapNodes = chain.flatMap((transport) =>
      taps(transport)
        .map((id) => byId.get(id))
        .filter((node): node is Node => Boolean(node)),
    );
    const sinkNodesForChain = chain.flatMap((transport) =>
      sinks(transport)
        .map((id) => byId.get(id))
        .filter((node): node is Node => Boolean(node)),
    );
    const chainX = isMerger
      ? sinkNodesForChain.length > 0
        ? Math.max(...sinkNodesForChain.map((node) => node.position.x)) +
          NODE_WIDTH +
          CHAIN_HORIZONTAL_GAP
        : byId.get(chain[0].id)!.position.x
      : tapNodes.length > 0
        ? Math.min(...tapNodes.map((node) => node.position.x)) -
          CHAIN_HORIZONTAL_GAP -
          SPLITTER_SIZE
        : byId.get(chain[0].id)!.position.x;

    let previousCenterY: number | undefined;
    for (const transport of chain) {
      const node = byId.get(transport.id)!;
      const roleNodes = (isMerger ? sinks(transport) : taps(transport))
        .map((id) => byId.get(id))
        .filter((roleNode): roleNode is Node => Boolean(roleNode));
      const roleCenterY =
        roleNodes.length > 0
          ? roleNodes.reduce(
              (sum, roleNode) => sum + roleNode.position.y + NODE_HEIGHT / 2,
              0,
            ) / roleNodes.length
          : undefined;
      const centerY =
        isJunctionChain && previousCenterY !== undefined
          ? previousCenterY + CHAIN_GAP
          : roleCenterY ??
            (previousCenterY !== undefined ? previousCenterY + CHAIN_GAP : undefined) ??
            node.position.y + SPLITTER_SIZE / 2;

      node.position = { x: chainX, y: centerY - SPLITTER_SIZE / 2 };

      if (!isMerger && previousCenterY === undefined) {
        const sinkNodes = sinks(transport)
          .map((id) => byId.get(id))
          .filter((sink): sink is Node => Boolean(sink));
        if (sinkNodes.length === 1) {
          const sink = sinkNodes[0];
          const isStacked = nodes.some(
            (other) =>
              other.id !== sink.id &&
              other.type === 'building' &&
              Math.abs(other.position.x - sink.position.x) < 1,
          );
          if (!isStacked) {
            sink.position = { ...sink.position, y: centerY - NODE_HEIGHT / 2 };
          }
        }
      }
      previousCenterY = centerY;
    }
  }
  return nodes;
};

export interface LineGraphProps {
  line?: SupplyLineModel;
  findings: Finding[];
  selectedBuildingId?: string;
  onSelectBuilding: (buildingId: string) => void;
}

export const LineGraph = ({
  line,
  findings,
  selectedBuildingId,
  onSelectBuilding,
}: LineGraphProps) => {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const modeColors = usePlannerColors();

  const { nodes, edges, hiddenCount, hasProblems } = useMemo(() => {
    if (!line) {
      return { nodes: [], edges: [], hiddenCount: 0, hasProblems: false };
    }

    let layout = layoutSupplyGraph(line, findings, problemsOnly, MAX_NODES);
    const visibleEdges = layout.edges;
    const attachedIds = new Set(layout.attachments.map((attachment) => attachment.controlId));
    const graphNodes: Node[] = [];

    for (const id of layout.visibleIds) {
      const node = line.nodes[id];
      if (!node) continue;
      const severity = severityOf(id, findings);
      const position = layout.positions.get(id) ?? { x: 0, y: 0 };
      const height = layout.heights.get(id) ?? NODE_HEIGHT;
      if (node.type === 'source' || node.type === 'transformer') {
        graphNodes.push({
          id,
          type: 'building',
          position,
          selected: id === selectedBuildingId,
          style: { width: NODE_WIDTH, height },
          data: {
            label: node.displayName,
            subtitle:
              node.type === 'transformer'
                ? node.recipeName ?? node.kind
                : 'Source',
            clock: node.clock,
            boost: node.boost,
            severity,
            ...(node.type === 'transformer' && node.inputs.length > 0
              ? { inputItems: [...new Set(node.inputs.map((port) => port.itemId))] }
              : {}),
            ...((node.type === 'source' || node.type === 'transformer') && node.outputs.length > 0
              ? { outputItems: [...new Set(node.outputs.map((port) => port.itemId))] }
              : {}),
          } satisfies BuildingNodeData,
        });
      } else if (node.type === 'control') {
        graphNodes.push({
          id,
          type: 'transport',
          position,
          selected: id === selectedBuildingId,
          style: { width: SPLITTER_SIZE, height },
          data: {
            label: node.kind === 'merger' ? 'M' : node.kind === 'storage' || node.kind === 'tank' ? 'T' : node.kind === 'junction' ? 'J' : 'S',
            kind: node.kind,
            severity: severityOf(id, findings),
            ...(node.kind === 'splitter' && node.bottleneck ? { bottleneck: true } : {}),
          } satisfies TransportNodeData,
        });
      }
    }

    const incoming = new Map<string, GraphEdge[]>();
    const outgoing = new Map<string, GraphEdge[]>();
    for (const edge of visibleEdges) {
      const inList = incoming.get(edge.to) ?? [];
      inList.push(edge);
      incoming.set(edge.to, inList);
      const outList = outgoing.get(edge.from) ?? [];
      outList.push(edge);
      outgoing.set(edge.from, outList);
    }
    const isChainControl = (id: string): boolean => {
      const node = line.nodes[id];
      return (
        node?.type === 'control' &&
        node.kind !== 'storage' &&
        node.kind !== 'tank'
      );
    };
    const controlNodes: SplitterNode[] = [];
    for (const id of layout.visibleIds) {
      const node = line.nodes[id];
      if (node?.type !== 'control' || attachedIds.has(id)) continue;
      const inputs = (incoming.get(id) ?? []).map((edge) => edge.from);
      const outputs = (outgoing.get(id) ?? []).map((edge) => edge.to);
      controlNodes.push({
        id,
        typeId: '',
        kind: node.kind,
        ...(node.itemId ? { itemId: node.itemId } : {}),
        inputs,
        outputs,
        directInputs: inputs,
        directOutputs: outputs,
        inputRoles: inputs.map((input) => ({
          id: input,
          role: isChainControl(input) ? 'continuation' : 'sink',
        })),
        outputRoles: outputs.map((output) => ({
          id: output,
          role: isChainControl(output) ? 'continuation' : 'tap',
        })),
      });
    }

    const centerOf = (
      id: string,
      positions: Map<string, { x: number; y: number }>,
    ) => {
      const node = line.nodes[id];
      const position = positions.get(id);
      if (!node || !position) return undefined;
      const width = node.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH;
      const height =
        layout.heights.get(id) ??
        (node.type === 'control' ? SPLITTER_SIZE : NODE_HEIGHT);
      return { x: position.x + width / 2, y: position.y + height / 2 };
    };

    const buildControlSides = (positions: Map<string, { x: number; y: number }>) => {
      const sideRequests: ControlSideRequest[] = [];
      for (const edge of visibleEdges) {
        for (const [controlId, otherId] of [
          [edge.from, edge.to],
          [edge.to, edge.from],
        ]) {
          if (line.nodes[controlId]?.type !== 'control') continue;
          const controlCenter = centerOf(controlId, positions);
          const otherCenter = centerOf(otherId, positions);
          if (!controlCenter || !otherCenter) continue;
          sideRequests.push({
            key: controlSideKey(edge.id, controlId),
            controlId,
            controlCenter,
            otherCenter,
          });
        }
      }
      return optimizeControlSides(
        line,
        visibleEdges,
        positions,
        layout.heights,
        assignControlSides(sideRequests),
      );
    };

    const initialSides = buildControlSides(layout.positions);
    const initialRoutes = routeEdges(
      line,
      visibleEdges,
      layout.positions,
      layout.heights,
      initialSides,
      layout.unitOf,
      layout.unitBounds,
    );
    const respaced = respaceColumns(layout, initialRoutes.demands);
    let finalUnitBounds = layout.unitBounds;
    if (respaced.shifted) {
      layout = { ...layout, positions: respaced.positions };
      for (const node of graphNodes) {
        const position = respaced.positions.get(node.id);
        if (position) node.position = position;
      }
      finalUnitBounds = new Map(layout.unitBounds);
      for (const [unitIdValue, shift] of respaced.unitShifts) {
        const bounds = finalUnitBounds.get(unitIdValue);
        if (bounds && shift !== 0) {
          finalUnitBounds.set(unitIdValue, { ...bounds, x: bounds.x + shift });
        }
      }
    }

    const positioned = alignStorageToConsumers(
      applyProductionGrid(
        layoutTransportChains(graphNodes, controlNodes),
        line,
        visibleEdges,
        layout.attachments,
        layout.heights,
      ),
      line,
      visibleEdges,
      layout.heights,
    );
    const finalPositions = new Map(positioned.map((node) => [node.id, node.position]));
    const controlSides = buildControlSides(finalPositions);
    const edgeRoutes = routeEdges(
      line,
      visibleEdges,
      finalPositions,
      layout.heights,
      controlSides,
      layout.unitOf,
      finalUnitBounds,
    ).routes;

    const obstacles: GraphObstacle[] = layout.visibleIds.flatMap((id) => {
      const node = line.nodes[id];
      const position = finalPositions.get(id);
      if (!node || !position) return [];
      const width = node.type === 'control' ? SPLITTER_SIZE : NODE_WIDTH;
      const height =
        layout.heights.get(id) ??
        (node.type === 'control' ? SPLITTER_SIZE : NODE_HEIGHT);
      return [{ x: position.x, y: position.y, width, height }];
    });

    const graphEdges: Edge[] = visibleEdges.map((edge) => {
      const color = edge.atCapacity ? plannerColors.info.color : modeColors.neutral;
      const label =
        edge.unknown || edge.itemId === 'unknown'
          ? undefined
          : formatNumber(edge.actualRate);
      const sourceNode = line.nodes[edge.from];
      const targetNode = line.nodes[edge.to];
      const sourceControl = sourceNode?.type === 'control';
      const targetControl = targetNode?.type === 'control';
      const sourceOutputHandle =
        !sourceControl &&
        (sourceNode?.type === 'source' || sourceNode?.type === 'transformer') &&
        sourceNode.outputs.some((port) => port.itemId === edge.itemId)
          ? `out-${edge.itemId}`
          : undefined;
      const sourceSide = controlSides.get(controlSideKey(edge.id, edge.from)) ?? 'right';
      const sourceHandle = sourceControl ? `out-${sourceSide}` : sourceOutputHandle;
      const targetInputHandle =
        !targetControl &&
        targetNode?.type === 'transformer' &&
        targetNode.inputs.some((port) => port.itemId === edge.itemId)
          ? `in-${edge.itemId}`
          : undefined;
      const targetSide = controlSides.get(controlSideKey(edge.id, edge.to)) ?? 'left';
      const targetHandle = targetControl ? `in-${targetSide}` : targetInputHandle;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        type: 'lane',
        data: {
          ...(edgeRoutes.get(edge.id)?.centerX !== undefined
            ? { centerX: edgeRoutes.get(edge.id)!.centerX }
            : {}),
          ...(edgeRoutes.get(edge.id)?.centerY !== undefined
            ? { centerY: edgeRoutes.get(edge.id)!.centerY }
            : {}),
          ...(label !== undefined ? { label } : {}),
          obstacles,
        } satisfies LaneEdgeData,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          ...(edge.actualRate === 0 || edge.unknown ? { strokeDasharray: '4 4' } : {}),
        },
      };
    });

    return {
      nodes: positioned,
      edges: graphEdges,
      hiddenCount: layout.hiddenCount,
      hasProblems: layout.problemIds.size > 0,
    };
  }, [line, findings, problemsOnly, modeColors, selectedBuildingId]);

  if (!line) {
    return (
      <Box
        className="planner-empty"
        sx={{
          minHeight: '16rem',
          bgcolor: 'background.paper',
          border: '1px dashed',
          borderColor: modeColors.borderSoft,
          borderRadius: 1,
        }}
      >
        <Typography>Select a supply line to see its flow graph.</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: modeColors.surface }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', justifyContent: 'space-between', px: 1.8, py: 1.2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <FormControlLabel
          control={
            <Switch
              id="planner-problems-only"
              checked={problemsOnly}
              onChange={(event) => setProblemsOnly(event.target.checked)}
            />
          }
          label="Problems only"
        />
        <Typography component="span" variant="caption" className="planner-muted">
          {line.buildingIds.length} buildings · {edges.length} flows
        </Typography>
      </Box>

      {problemsOnly && !hasProblems && (
        <Alert severity="success" sx={{ m: 0, borderRadius: 0 }}>
          This line has no estimated problems.
        </Alert>
      )}
      {hiddenCount > 0 && (
        <Alert severity="warning" sx={{ m: 0, borderRadius: 0 }}>
          Graph limited to the first {MAX_NODES} nodes in this line. {hiddenCount} more are listed in
          the line details.
        </Alert>
      )}

      <Box sx={{ height: { xs: 520, md: 720 }, bgcolor: modeColors.surfaceMuted }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => {
            const supplyNode = line.nodes[node.id];
            if (
              supplyNode?.type === 'source' ||
              supplyNode?.type === 'transformer' ||
              supplyNode?.type === 'control'
            ) {
              onSelectBuilding(node.id);
            }
          }}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onlyRenderVisibleElements
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </Box>
      {selectedBuildingId && (
        <Typography
          className="planner-muted"
          variant="caption"
          component="p"
          sx={{ m: 0, px: 1.8, py: 0.8, borderTop: '1px solid', borderColor: 'divider' }}
        >
          Selected: <code>{selectedBuildingId}</code>
        </Typography>
      )}
    </Box>
  );
};
