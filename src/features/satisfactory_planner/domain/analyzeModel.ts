import { gameData } from '../api/gameData';
import { buildSupplyLineModel, type AssignedTransportNodes } from './buildSupplyLineModel';
import { detectBottlenecks } from './detectBottlenecks';
import type { LineStats } from './lineStats';
import type { Finding, NormalizedSave, SupplyLineModel } from './types';

export interface PlannerAnalysis {
  supplyLines: SupplyLineModel[];
  findings: Finding[];
  lineStats: LineStats;
}

export const analyzeModel = (
  model: NormalizedSave,
  data = gameData,
): PlannerAnalysis => {
  const lineForBuilding = new Map<string, string>();
  for (const line of model.lines) {
    for (const buildingId of line.buildingIds) lineForBuilding.set(buildingId, line.id);
  }

  const assignment = new Map<string, AssignedTransportNodes>();
  const ensure = (lineId: string): AssignedTransportNodes => {
    const existing = assignment.get(lineId);
    if (existing) return existing;
    const created = { transportNodes: [], transportRuns: [] };
    assignment.set(lineId, created);
    return created;
  };

  const chooseLine = (ids: string[]): string | undefined => {
    const counts = new Map<string, number>();
    for (const id of ids) {
      const lineId = lineForBuilding.get(id);
      if (!lineId) continue;
      counts.set(lineId, (counts.get(lineId) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0]?.[0];
  };

  for (const transport of model.transportNodes ?? []) {
    const lineId = chooseLine([...transport.inputs, ...transport.outputs]);
    if (!lineId) continue;
    ensure(lineId).transportNodes.push(transport);
  }
  for (const run of model.transportRuns ?? []) {
    const lineId = chooseLine([run.fromNodeId, run.toNodeId]);
    if (!lineId) continue;
    ensure(lineId).transportRuns.push(run);
  }

  const supplyLines = model.lines.map((line) => {
    const built = buildSupplyLineModel(model, line, data, ensure(line.id));
    if (built.buildingIds.length === 0) built.buildingIds = [...line.buildingIds];
    if (built.summary.inputs.length === 0 && built.summary.outputs.length === 0) {
      const balanceByItem = new Map(
        line.balance.map((entry) => [entry.itemId, entry.supply]),
      );
      const items = new Set([
        ...line.balance.filter((entry) => entry.supply > 0).map((entry) => entry.itemId),
        ...line.outputItems,
      ]);
      if (items.size > 0) {
        built.summary.outputs = [...items].map((itemId) => {
          const rate = balanceByItem.get(itemId) ?? 0;
          return {
            itemId,
            expectedRate: rate,
            actualRate: rate,
            unit:
              data.items[itemId]?.form === 'liquid' ||
              data.items[itemId]?.form === 'gas'
                ? 'm³/min'
                : 'items/min',
          };
        });
        built.notes = [...built.notes, 'Rates derived from legacy line data.'];
      }
    }
    return built;
  });
  const findings = [
    ...detectBottlenecks(model, data, supplyLines),
    ...(model.findings ?? []),
  ];

  const modeledIds = new Set(
    model.buildings.filter((building) => building.modeled).map((building) => building.id),
  );
  const activeLines = supplyLines.filter((line) => line.buildingIds.length > 1);
  const inLines = new Set<string>();
  for (const line of activeLines) {
    for (const id of line.buildingIds) {
      if (modeledIds.has(id)) inLines.add(id);
    }
  }
  const totalCandidates = model.buildings.length;
  const lineStats = {
    activeLines,
    buildingsInLines: inLines.size,
    totalModeled: modeledIds.size,
    totalCandidates,
    flows: activeLines.reduce(
      (total, line) =>
        total +
        Object.values(line.nodes).reduce(
          (count, node) => count + (node.type === 'transport' ? 0 : (node.outputs?.length ?? 0)),
          0,
        ),
      0,
    ),
    ratio: totalCandidates === 0 ? 0 : inLines.size / totalCandidates,
  };

  return {
    supplyLines,
    findings,
    lineStats,
  };
};
