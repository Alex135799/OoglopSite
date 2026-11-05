import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { Building, Finding, LineFlow, ProductionLine, Severity, SplitterNode } from '../domain/types';
import { formatNumber, itemName } from '../format';
import { plannerColors, usePlannerColors, type PlannerModeColors } from '../theme';

interface BuildingNodeData {
  label: string;
  subtitle: string;
  clock: number;
  severity?: Severity;
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
        gap: 0.3,
        width: 220,
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

interface SplitterNodeData {
  label: 'S';
  [key: string]: unknown;
}

const SplitterNode = ({ selected }: NodeProps) => {
  const node = usePlannerColors();
  return (
    <Box
      aria-label="Splitter"
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
          bgcolor: node.surface,
          boxShadow: selected
            ? `0 0 0 3px ${plannerColors.primary.color}`
            : `0 1px 3px ${node.shadowStrong}`,
        }}
      />
      <Box component="span" sx={{ position: 'relative', color: node.textPrimary }}>
        S
      </Box>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </Box>
  );
};

const nodeTypes = { building: BuildingNode, splitter: SplitterNode };

const NODE_WIDTH = 220;
const NODE_HEIGHT = 86;
const SPLITTER_SIZE = 44;
const MAX_NODES = 150;

const layout = (nodes: Node[], edges: Edge[]): Node[] => {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 30, ranksep: 90, marginx: 20, marginy: 20 });
  for (const node of nodes) {
    const width = node.type === 'splitter' ? SPLITTER_SIZE : NODE_WIDTH;
    const height = node.type === 'splitter' ? SPLITTER_SIZE : NODE_HEIGHT;
    graph.setNode(node.id, { width, height });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return nodes.map((node) => {
    const point = graph.node(node.id);
    const width = node.type === 'splitter' ? SPLITTER_SIZE : NODE_WIDTH;
    const height = node.type === 'splitter' ? SPLITTER_SIZE : NODE_HEIGHT;
    return {
      ...node,
      position: { x: point.x - width / 2, y: point.y - height / 2 },
    };
  });
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
  line?: ProductionLine;
  buildings: Map<string, Building>;
  splitters?: SplitterNode[];
  findings: Finding[];
  selectedBuildingId?: string;
  onSelectBuilding: (buildingId: string) => void;
}

export const LineGraph = ({
  line,
  buildings,
  splitters = [],
  findings,
  selectedBuildingId,
  onSelectBuilding,
}: LineGraphProps) => {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const modeColors = usePlannerColors();

  const { nodes, edges, hiddenCount, hasProblems } = useMemo(() => {
    if (!line) return { nodes: [], edges: [], hiddenCount: 0, hasProblems: false };

    const lineBuildingIds = new Set(line.buildingIds);
    const problemIds = new Set(
      findings.flatMap((finding) => finding.buildingIds ?? []).filter((id) => lineBuildingIds.has(id)),
    );
    let keep = new Set(line.buildingIds);
    if (problemsOnly && problemIds.size > 0) {
      keep = new Set(problemIds);
      for (const flow of line.flows) {
        if (problemIds.has(flow.from) || problemIds.has(flow.to)) {
          keep.add(flow.from);
          keep.add(flow.to);
        }
      }
    } else if (problemsOnly) {
      keep = new Set();
    }

    const ordered = line.buildingIds.filter((id) => keep.has(id));
    const hidden = Math.max(0, ordered.length - MAX_NODES);
    const limited = ordered.slice(0, MAX_NODES);
    const visible = new Set(limited);

    const graphNodes: Node[] = limited.map((id) => {
      const building = buildings.get(id);
      const severity = severityOf(id, findings);
      return {
        id,
        type: 'building',
        position: { x: 0, y: 0 },
        style: { width: NODE_WIDTH },
        data: {
          label: building?.displayName ?? id,
          subtitle: building?.recipeName ?? building?.typeId ?? 'Unknown building',
          clock: building?.clock ?? 1,
          severity,
        } satisfies BuildingNodeData,
      };
    });

    const visibleFlows = line.flows.filter(
      (flow) => visible.has(flow.from) && visible.has(flow.to),
    );
    const replaced = new Set<LineFlow>();
    const graphEdges: Edge[] = [];

    for (const splitter of splitters) {
      const upstream = splitter.inputs.filter((id) => visible.has(id));
      const downstream = splitter.outputs.filter((id) => visible.has(id));
      if (upstream.length === 0 || downstream.length === 0) continue;

      const matching = visibleFlows.filter(
        (flow) =>
          !replaced.has(flow) &&
          upstream.includes(flow.from) &&
          downstream.includes(flow.to),
      );
      if (matching.length === 0) continue;

      const byItem = new Map<string, number>();
      for (const flow of matching) {
        byItem.set(flow.itemId, (byItem.get(flow.itemId) ?? 0) + flow.rate);
      }
      const selectedItem =
        splitter.itemId && byItem.has(splitter.itemId)
          ? splitter.itemId
          : [...byItem.entries()].sort(
              (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
            )[0]?.[0];
      if (!selectedItem) continue;

      const selected = matching.filter((flow) => flow.itemId === selectedItem);
      const total = selected.reduce((sum, flow) => sum + flow.rate, 0);
      if (total <= 0) continue;
      for (const flow of selected) replaced.add(flow);

      const targets = new Map<string, number>();
      const sources = new Map<string, number>();
      for (const flow of selected) {
        targets.set(flow.to, (targets.get(flow.to) ?? 0) + flow.rate);
        sources.set(flow.from, (sources.get(flow.from) ?? 0) + flow.rate);
      }
      const equalRate = total / targets.size;

      graphNodes.push({
        id: splitter.id,
        type: 'splitter',
        position: { x: 0, y: 0 },
        style: { width: SPLITTER_SIZE },
        data: { label: 'S' } satisfies SplitterNodeData,
      });

      for (const [from, rate] of sources) {
        const severity = severityOf(from, findings);
        graphEdges.push({
          id: `${from}->${splitter.id}:${selectedItem}`,
          source: from,
          target: splitter.id,
          label: `${itemName(selectedItem)} ${formatNumber(rate)}`,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor(severity, modeColors),
          },
          style: { stroke: edgeColor(severity, modeColors) },
          labelStyle: { fontSize: 11, fill: modeColors.textSecondary },
          labelBgStyle: { fill: modeColors.surface, fillOpacity: 0.85 },
        });
      }

      for (const to of targets.keys()) {
        const severity = severityOf(to, findings);
        graphEdges.push({
          id: `${splitter.id}->${to}:${selectedItem}`,
          source: splitter.id,
          target: to,
          label: `${itemName(selectedItem)} ${formatNumber(equalRate)}`,
          type: 'smoothstep',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: edgeColor(severity, modeColors),
          },
          style: { stroke: edgeColor(severity, modeColors) },
          labelStyle: { fontSize: 11, fill: modeColors.textSecondary },
          labelBgStyle: { fill: modeColors.surface, fillOpacity: 0.85 },
        });
      }
    }

    for (const flow of visibleFlows) {
      if (replaced.has(flow)) continue;
      const severity = severityOf(flow.to, findings);
      graphEdges.push({
        id: `${flow.from}->${flow.to}:${flow.itemId}`,
        source: flow.from,
        target: flow.to,
        label:
          flow.itemId === 'unknown'
            ? 'Unknown · 0/min'
            : `${itemName(flow.itemId)} ${formatNumber(flow.rate)}`,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(severity, modeColors) },
        style: {
          stroke: edgeColor(severity, modeColors),
          ...(flow.rate === 0 ? { strokeDasharray: '4 4' } : {}),
        },
        labelStyle: { fontSize: 11, fill: modeColors.textSecondary },
        labelBgStyle: { fill: modeColors.surface, fillOpacity: 0.85 },
      });
    }

    return {
      nodes: layout(graphNodes, graphEdges),
      edges: graphEdges,
      hiddenCount: hidden,
      hasProblems: problemIds.size > 0,
    };
  }, [line, buildings, splitters, findings, problemsOnly, modeColors]);

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
          {line.buildingIds.length} buildings · {line.flows.length} flows
        </Typography>
      </Box>

      {problemsOnly && !hasProblems && (
        <Alert severity="success" sx={{ m: 0, borderRadius: 0 }}>
          This line has no estimated problems.
        </Alert>
      )}
      {hiddenCount > 0 && (
        <Alert severity="warning" sx={{ m: 0, borderRadius: 0 }}>
          Graph limited to the first {MAX_NODES} buildings in this line. {hiddenCount} more are
          listed in the line details.
        </Alert>
      )}

      <Box sx={{ height: { xs: 380, md: 480 }, bgcolor: modeColors.surfaceMuted }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => onSelectBuilding(node.id)}
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
