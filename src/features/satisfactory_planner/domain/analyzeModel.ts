import { gameData } from '../api/gameData';
import { buildSupplyLineModel, type AssignedTransportNodes } from './buildSupplyLineModel';
import { detectBottlenecks } from './detectBottlenecks';
import type { LineStats } from './lineStats';
import type { Finding, NormalizedSave, SupplyLineModel } from './types';

export interface PlannerAnalysis {
  supplyLines: SupplyLineModel[];
  findings: Finding[];
  lineStats: LineStats;
  power: {
    expectedGeneration: number;
    actualGeneration: number;
    expectedConsumption: number;
    actualConsumption: number;
  };
}

const mergeTransportLines = (model: NormalizedSave) => {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const value = parent.get(id) ?? id;
    if (value === id) return id;
    const root = find(value);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const lineForBuilding = new Map<string, string>();
  for (const line of model.lines) {
    for (const id of line.buildingIds) lineForBuilding.set(id, line.id);
  }
  const joinIds = (ids: string[]) => {
    const lineIds = [...new Set(ids.map((id) => lineForBuilding.get(id)).filter(Boolean))] as string[];
    for (let index = 1; index < lineIds.length; index += 1) {
      union(lineIds[0], lineIds[index]);
    }
  };
  for (const node of model.transportNodes ?? []) {
    joinIds([...node.inputs, ...node.outputs]);
  }
  for (const run of model.transportRuns ?? []) {
    joinIds([run.fromNodeId, run.toNodeId]);
  }
  const groups = new Map<string, typeof model.lines>();
  for (const line of model.lines) {
    const root = find(line.id);
    const list = groups.get(root) ?? [];
    list.push(line);
    groups.set(root, list);
  }
  if ([...groups.values()].every((group) => group.length === 1)) return model.lines;
  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    const balanceByItem = new Map<string, { itemId: string; supply: number; demand: number }>();
    for (const line of group) {
      for (const entry of line.balance) {
        const existing = balanceByItem.get(entry.itemId) ?? {
          itemId: entry.itemId,
          supply: 0,
          demand: 0,
        };
        existing.supply += entry.supply;
        existing.demand += entry.demand;
        balanceByItem.set(entry.itemId, existing);
      }
    }
    return {
      ...group[0],
      name: group[0].name,
      buildingIds: [...new Set(group.flatMap((line) => line.buildingIds))],
      outputItems: [...new Set(group.flatMap((line) => line.outputItems))],
      flows: group.flatMap((line) => line.flows),
      balance: [...balanceByItem.values()],
    };
  });
};

export const analyzeModel = (
  model: NormalizedSave,
  data = gameData,
): PlannerAnalysis => {
  const lines = mergeTransportLines(model);
  const lineForBuilding = new Map<string, string>();
  for (const line of lines) {
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

  const transportLine = new Map<string, string>();
  const transportById = new Map(
    (model.transportNodes ?? []).map((transport) => [transport.id, transport]),
  );
  for (const transport of model.transportNodes ?? []) {
    const lineId = chooseLine([...transport.inputs, ...transport.outputs]);
    if (!lineId) continue;
    transportLine.set(transport.id, lineId);
    ensure(lineId).transportNodes.push(transport);
  }
  for (const run of model.transportRuns ?? []) {
    const lineId =
      chooseLine([run.fromNodeId, run.toNodeId]) ??
      transportLine.get(run.fromNodeId) ??
      transportLine.get(run.toNodeId);
    if (!lineId) continue;
    for (const id of [run.fromNodeId, run.toNodeId]) {
      if (transportLine.has(id)) continue;
      const transport = transportById.get(id);
      if (!transport) continue;
      transportLine.set(id, lineId);
      ensure(lineId).transportNodes.push(transport);
    }
    ensure(lineId).transportRuns.push(run);
  }

  const supplyLines = lines.map((line) => {
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
  const power = supplyLines.reduce(
    (total, line) => ({
      expectedGeneration: total.expectedGeneration + line.summary.power.expectedGeneration,
      actualGeneration: total.actualGeneration + line.summary.power.actualGeneration,
      expectedConsumption: total.expectedConsumption + line.summary.power.expectedConsumption,
      actualConsumption: total.actualConsumption + line.summary.power.actualConsumption,
    }),
    {
      expectedGeneration: 0,
      actualGeneration: 0,
      expectedConsumption: 0,
      actualConsumption: 0,
    },
  );
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
    power,
  };
};
