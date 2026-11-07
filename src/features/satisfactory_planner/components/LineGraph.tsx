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
import { formatNumber, itemName } from '../format';
import { layoutSupplyGraph, type GraphEdge } from './lineGraphLayout';
import { plannerColors, usePlannerColors, type PlannerModeColors } from '../theme';

interface BuildingNodeData {
  label: string;
  subtitle: string;
  clock: number;
  severity?: Severity;
  [key: string]: unknown;
}

interface TransportNodeData {
  label: 'S' | 'M' | 'T';
  kind: 'splitter' | 'merger' | 'storage';
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
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0.3,
        width: 220,
        height: '100%',
        p: '0.55rem 0.7rem',
        border: '2px solid',
        borderColor: colors.border,
        borderRadius: '0.45rem',
        bgcolor: colors.background,
        boxShadow: selected
          ? `0 0 0 3px ${plannerColors.primary.color}`
          : `0 1px 3px ${modeColors.shadowStrong}`,
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
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
      <strong>{node.label}</strong>
      <Box component="span" className="planner-graph-meta">{node.subtitle}</Box>
      <Box component="span" className="planner-graph-meta">
        Clock {Math.round(node.clock * 100)}%
      </Box>
    </Box>
  );
};

const TransportNodeShape = ({ data, selected }: NodeProps) => {
  const transport = data as unknown as TransportNodeData;
  const modeColors = usePlannerColors();
  return (
    <Box
      aria-label={
        transport.kind === 'merger'
          ? 'Merger'
          : transport.kind === 'storage'
            ? 'Storage'
            : 'Splitter'
      }
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
          borderColor: plannerColors.secondary.color,
          borderRadius: '4px',
          bgcolor: modeColors.surface,
          boxShadow: selected
            ? `0 0 0 3px ${plannerColors.primary.color}`
            : `0 1px 3px ${modeColors.shadowStrong}`,
        }}
      />
      <Box component="span" sx={{ position: 'relative', color: modeColors.textPrimary }}>
        {transport.label}
      </Box>
      <Handle type="target" position={Position.Left} id="in-left" isConnectable={false} />
      <Handle type="source" position={Position.Right} id="out-right" isConnectable={false} />
      <Handle type="target" position={Position.Top} id="in-top" isConnectable={false} />
      <Handle type="source" position={Position.Top} id="out-top" isConnectable={false} />
      <Handle type="target" position={Position.Bottom} id="in-bottom" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} id="out-bottom" isConnectable={false} />
    </Box>
  );
};

const nodeTypes = { building: BuildingNode, transport: TransportNodeShape };

interface LaneEdgeData {
  laneOffset: number;
  label: string;
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
    centerX: (sourceX + targetX) / 2 + (lane.laneOffset ?? 0),
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <Box
          sx={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'none',
            bgcolor: modeColors.surface,
            color: modeColors.textSecondary,
            fontSize: 11,
            px: 0.4,
            borderRadius: 0.5,
            whiteSpace: 'nowrap',
          }}
        >
          {lane.label}
        </Box>
      </EdgeLabelRenderer>
    </>
  );
};

const edgeTypes = { lane: LaneEdge };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 86;
const SPLITTER_SIZE = 44;
const STACK_GAP = 16;
const MAX_NODES = 150;

const CHAIN_HORIZONTAL_GAP = 70;
const CHAIN_GAP = NODE_HEIGHT + STACK_GAP;

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
      if (taps(current).length > 1) break;
      if (continuationOut(current).length > 1) break;
      if (continuationIn(current).length > 1) break;
      chain.push(current);
      visited.add(current.id);
      const nextId: string | undefined = continuationOut(current)[0];
      current = nextId ? transportById.get(nextId) : undefined;
    }
    if (chain.length === 0) continue;
    const isMerger = chain[0].kind === 'merger';

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
        roleCenterY ??
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

const edgeColor = (severity: Severity | undefined, colors: PlannerModeColors): string => {
  switch (severity) {
    case 'critical':
      return plannerColors.critical.color;
    case 'warning':
      return plannerColors.warning.color;
    case 'info':
      return plannerColors.info.color;
    default:
      return colors.neutral;
  }
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

    const layout = layoutSupplyGraph(line, findings, problemsOnly, MAX_NODES);
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
          style: { width: NODE_WIDTH, height },
          data: {
            label: node.displayName,
            subtitle:
              node.type === 'transformer'
                ? node.recipeName ?? node.kind
                : 'Source',
            clock: node.clock,
            severity,
          } satisfies BuildingNodeData,
        });
      } else if (node.type === 'control') {
        graphNodes.push({
          id,
          type: 'transport',
          position,
          style: { width: SPLITTER_SIZE, height },
          data: {
            label: node.kind === 'merger' ? 'M' : node.kind === 'storage' ? 'T' : 'S',
            kind: node.kind,
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
          role: line.nodes[input]?.type === 'control' ? 'continuation' : 'sink',
        })),
        outputRoles: outputs.map((output) => ({
          id: output,
          role: line.nodes[output]?.type === 'control' ? 'continuation' : 'tap',
        })),
      });
    }

    const positioned = layoutTransportChains(graphNodes, controlNodes);

    const bySource = new Map<string, GraphEdge[]>();
    const byTarget = new Map<string, GraphEdge[]>();
    for (const edge of visibleEdges) {
      const sourceList = bySource.get(edge.from) ?? [];
      sourceList.push(edge);
      bySource.set(edge.from, sourceList);
      const targetList = byTarget.get(edge.to) ?? [];
      targetList.push(edge);
      byTarget.set(edge.to, targetList);
    }
    for (const list of bySource.values()) {
      list.sort((a, b) => a.to.localeCompare(b.to) || a.itemId.localeCompare(b.itemId));
    }
    for (const list of byTarget.values()) {
      list.sort((a, b) => a.from.localeCompare(b.from) || a.itemId.localeCompare(b.itemId));
    }
    const laneOffsets = new Map<string, number>();
    const pairIndex = new Map<string, number>();
    for (const edge of visibleEdges) {
      const pairKey = `${edge.from}\u0000${edge.to}`;
      const indexInPair = pairIndex.get(pairKey) ?? 0;
      pairIndex.set(pairKey, indexInPair + 1);
      const sourceList = bySource.get(edge.from) ?? [];
      const targetList = byTarget.get(edge.to) ?? [];
      const sourceIndex = sourceList.indexOf(edge);
      const targetIndex = targetList.indexOf(edge);
      const sourceLane =
        (sourceIndex - (Math.max(1, sourceList.length) - 1) / 2) * 14;
      const targetLane =
        (targetIndex - (Math.max(1, targetList.length) - 1) / 2) * 8;
      laneOffsets.set(edge.id, sourceLane + targetLane + indexInPair * 10);
    }

    const graphEdges: Edge[] = visibleEdges.map((edge) => {
      const severity = severityOf(edge.to, findings);
      const color = edgeColor(severity, modeColors);
      const label =
        edge.unknown || edge.itemId === 'unknown'
          ? 'Unknown · 0/min'
          : `${itemName(edge.itemId)} ${formatNumber(edge.actualRate)}`;
      const sourceNode = line.nodes[edge.from];
      const targetNode = line.nodes[edge.to];
      const sourceControl = sourceNode?.type === 'control';
      const targetControl = targetNode?.type === 'control';
      const sourcePosition = positioned.find((node) => node.id === edge.from)?.position;
      const targetPosition = positioned.find((node) => node.id === edge.to)?.position;
      const verticalControl =
        sourceControl &&
        targetControl &&
        sourcePosition &&
        targetPosition &&
        (Math.abs(sourcePosition.x - targetPosition.x) < 60 ||
          attachedIds.has(edge.from) ||
          attachedIds.has(edge.to));
      const sourceHandle = verticalControl
        ? sourcePosition.y <= targetPosition.y
          ? 'out-bottom'
          : 'out-top'
        : sourceControl
          ? 'out-right'
          : undefined;
      const targetHandle = verticalControl
        ? targetPosition.y >= sourcePosition.y
          ? 'in-top'
          : 'in-bottom'
        : targetControl
          ? 'in-left'
          : undefined;
      return {
        id: edge.id,
        source: edge.from,
        target: edge.to,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        type: 'lane',
        data: {
          laneOffset: laneOffsets.get(edge.id) ?? 0,
          label,
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
  }, [line, findings, problemsOnly, modeColors]);

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

      <Box sx={{ height: { xs: 380, md: 480 }, bgcolor: modeColors.surfaceMuted }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => {
            const supplyNode = line.nodes[node.id];
            if (supplyNode?.type === 'source' || supplyNode?.type === 'transformer') {
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
