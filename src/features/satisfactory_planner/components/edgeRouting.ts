import type {
  GraphEdge,
  ColumnGapDemand,
  ControlSide,
} from './lineGraphLayout';
import {
  CONTROL_SIZE,
  NODE_HEIGHT,
  NODE_WIDTH,
  controlSideKey,
  portFraction,
  sideAnchor,
} from './lineGraphLayout';
import type { SupplyLineModel, SupplyNode } from '../domain/types';

export const LANE_PITCH = 28;
export const LANE_END_PADDING = 28;

export interface EdgeRoute {
  edgeId: string;
  centerX?: number;
  centerY?: number;
  laneIndex: number;
  spanStart: number;
  spanEnd: number;
  corridorKey: string;
}

export interface RoutingResult {
  routes: Map<string, EdgeRoute>;
  demands: ColumnGapDemand[];
}

interface Anchor {
  x: number;
  y: number;
  side: ControlSide;
  vertical: boolean;
}

interface RouteCandidate {
  edge: GraphEdge;
  source: Anchor;
  target: Anchor;
  sourceUnit: string;
  targetUnit: string;
  axis: 'x' | 'y';
  corridorKey: string;
  spanStart: number;
  spanEnd: number;
}

const nodeSize = (
  node: SupplyNode,
  height: number | undefined,
): { width: number; height: number } => ({
  width: node.type === 'control' ? CONTROL_SIZE : NODE_WIDTH,
  height:
    height ??
    (node.type === 'control' ? CONTROL_SIZE : NODE_HEIGHT),
});

const columnKey = (
  unitId: string,
  unitBounds: Map<string, { x: number; y: number; width: number; height: number }>,
): number | undefined => {
  const bounds = unitBounds.get(unitId);
  return bounds ? Math.round(bounds.x + bounds.width / 2) : undefined;
};

const anchorFor = (
  line: SupplyLineModel,
  edge: GraphEdge,
  nodeId: string,
  role: 'from' | 'to',
  positions: Map<string, { x: number; y: number }>,
  heights: Map<string, number>,
  sides: Map<string, ControlSide>,
): Anchor | undefined => {
  const node = line.nodes[nodeId];
  const position = positions.get(nodeId);
  if (!node || !position) return undefined;
  const size = nodeSize(node, heights.get(nodeId));
  if (node.type === 'control') {
    const side =
      sides.get(controlSideKey(edge.id, nodeId)) ??
      (role === 'from' ? 'right' : 'left');
    return {
      ...sideAnchor(
        { x: position.x + size.width / 2, y: position.y + size.height / 2 },
        side,
      ),
      side,
      vertical: side === 'top' || side === 'bottom',
    };
  }
  if (role === 'from') {
    const ports =
      node.type === 'source' || node.type === 'transformer' ? node.outputs : undefined;
    return {
      x: position.x + size.width,
      y: position.y + size.height * portFraction(ports, edge.itemId),
      side: 'right',
      vertical: false,
    };
  }
  const ports = node.type === 'transformer' ? node.inputs : undefined;
  return {
    x: position.x,
    y: position.y + size.height * portFraction(ports, edge.itemId),
    side: 'left',
    vertical: false,
  };
};

export const routeEdges = (
  line: SupplyLineModel,
  edges: GraphEdge[],
  positions: Map<string, { x: number; y: number }>,
  heights: Map<string, number>,
  sides: Map<string, ControlSide>,
  unitOf: Map<string, string>,
  unitBounds: Map<string, { x: number; y: number; width: number; height: number }>,
): RoutingResult => {
  const candidates: RouteCandidate[] = [];
  for (const edge of edges) {
    const source = anchorFor(line, edge, edge.from, 'from', positions, heights, sides);
    const target = anchorFor(line, edge, edge.to, 'to', positions, heights, sides);
    if (!source || !target) continue;
    const sourceUnit = unitOf.get(edge.from) ?? edge.from;
    const targetUnit = unitOf.get(edge.to) ?? edge.to;
    const horizontal = !source.vertical && !target.vertical;
    const vertical = source.vertical && target.vertical;
    const axis =
      horizontal || (!vertical && Math.abs(target.x - source.x) >= Math.abs(target.y - source.y))
        ? 'x'
        : 'y';
    const sourceColumn = columnKey(sourceUnit, unitBounds);
    const targetColumn = columnKey(targetUnit, unitBounds);
    const corridorKey =
      axis === 'x' &&
      sourceColumn !== undefined &&
      targetColumn !== undefined &&
      sourceColumn !== targetColumn
        ? `x:${Math.min(sourceColumn, targetColumn)}>${Math.max(sourceColumn, targetColumn)}`
        : axis === 'x'
          ? `x:self:${sourceColumn ?? sourceUnit}`
          : `y:${sourceUnit}>${targetUnit}`;
    const spanStart = axis === 'x' ? Math.min(source.y, target.y) : Math.min(source.x, target.x);
    const spanEnd = axis === 'x' ? Math.max(source.y, target.y) : Math.max(source.x, target.x);
    candidates.push({
      edge,
      source,
      target,
      sourceUnit,
      targetUnit,
      axis,
      corridorKey,
      spanStart,
      spanEnd,
    });
  }

  const groups = new Map<string, RouteCandidate[]>();
  for (const candidate of candidates) {
    const list = groups.get(candidate.corridorKey) ?? [];
    list.push(candidate);
    groups.set(candidate.corridorKey, list);
  }

  const routes = new Map<string, EdgeRoute>();
  const demands: ColumnGapDemand[] = [];
  for (const [corridorKey, list] of groups) {
    list.sort(
      (a, b) => a.spanStart - b.spanStart || a.edge.id.localeCompare(b.edge.id),
    );
    const laneLastEnd: number[] = [];
    for (const candidate of list) {
      let laneIndex = laneLastEnd.findIndex(
        (lastEnd) => candidate.spanStart >= lastEnd + LANE_END_PADDING,
      );
      if (laneIndex < 0) laneIndex = laneLastEnd.length;
      laneLastEnd[laneIndex] = candidate.spanEnd;
      const dx = candidate.target.x - candidate.source.x;
      const dy = candidate.target.y - candidate.source.y;
      const direction = candidate.axis === 'x' ? (dx >= 0 ? 1 : -1) : dy >= 0 ? 1 : -1;
      const base = candidate.axis === 'x' ? candidate.source.x : candidate.source.y;
      const laneCoordinate = base + direction * (LANE_END_PADDING + laneIndex * LANE_PITCH);
      routes.set(candidate.edge.id, {
        edgeId: candidate.edge.id,
        centerX:
          candidate.axis === 'x'
            ? laneCoordinate
            : (candidate.source.x + candidate.target.x) / 2,
        centerY:
          candidate.axis === 'y'
            ? laneCoordinate
            : (candidate.source.y + candidate.target.y) / 2,
        laneIndex,
        spanStart: candidate.spanStart,
        spanEnd: candidate.spanEnd,
        corridorKey,
      });
    }
    if (corridorKey.startsWith('x:') && !corridorKey.startsWith('x:self:')) {
      const first = list[0];
      const leftIsSource = first.source.x <= first.target.x;
      demands.push({
        leftUnitId: leftIsSource ? first.sourceUnit : first.targetUnit,
        rightUnitId: leftIsSource ? first.targetUnit : first.sourceUnit,
        requiredGap: 2 * LANE_END_PADDING + laneLastEnd.length * LANE_PITCH,
      });
    }
  }
  return { routes, demands };
};
