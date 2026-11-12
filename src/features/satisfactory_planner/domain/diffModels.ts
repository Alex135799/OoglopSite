import type {
  Building,
  BuildingChange,
  CheckpointRecord,
  Finding,
  LineChange,
  LineSummary,
  ModelDiff,
  NormalizedSave,
  SupplyLineModel,
} from './types';
import { round } from './rateMath';
import { analyzeModel } from './analyzeModel';

const outputSignature = (line: SupplyLineModel): string =>
  line.summary.outputs.length > 0
    ? line.summary.outputs.map((entry) => entry.itemId).sort().join('|')
    : '∅';

const sortLines = (lines: SupplyLineModel[]): SupplyLineModel[] =>
  [...lines].sort(
    (a, b) =>
      outputSignature(a).localeCompare(outputSignature(b)) ||
      a.buildingIds.length - b.buildingIds.length ||
      a.buildingIds.join(',').localeCompare(b.buildingIds.join(',')),
  );

const summarizeLine = (line: SupplyLineModel, key: string): LineSummary => ({
  key,
  name: line.name,
  outputItems: line.summary.outputs.map((entry) => entry.itemId),
  buildingCount: line.buildingIds.length,
  balance: line.summary.outputs.map((entry) => ({
    itemId: entry.itemId,
    supply: entry.actualRate,
    demand: entry.expectedRate,
  })),
});

interface MatchedLine {
  key: string;
  before?: SupplyLineModel;
  after?: SupplyLineModel;
}

const matchLines = (before: SupplyLineModel[], after: SupplyLineModel[]): MatchedLine[] => {
  const beforeGroups = new Map<string, SupplyLineModel[]>();
  const afterGroups = new Map<string, SupplyLineModel[]>();
  for (const line of sortLines(before)) {
    const signature = outputSignature(line);
    const list = beforeGroups.get(signature) ?? [];
    list.push(line);
    beforeGroups.set(signature, list);
  }
  for (const line of sortLines(after)) {
    const signature = outputSignature(line);
    const list = afterGroups.get(signature) ?? [];
    list.push(line);
    afterGroups.set(signature, list);
  }

  const signatures = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  const matches: MatchedLine[] = [];
  for (const signature of [...signatures].sort()) {
    const beforeList = beforeGroups.get(signature) ?? [];
    const afterList = afterGroups.get(signature) ?? [];
    const count = Math.max(beforeList.length, afterList.length);
    for (let index = 0; index < count; index += 1) {
      matches.push({
        key: `${signature}#${index + 1}`,
        ...(beforeList[index] ? { before: beforeList[index] } : {}),
        ...(afterList[index] ? { after: afterList[index] } : {}),
      });
    }
  }
  return matches;
};

const balanceMap = (line: SupplyLineModel): Map<string, number> =>
  new Map(line.summary.outputs.map((entry) => [entry.itemId, entry.actualRate]));

const lineChanges = (before: SupplyLineModel[], after: SupplyLineModel[]) => {
  const added: LineSummary[] = [];
  const removed: LineSummary[] = [];
  const changed: LineChange[] = [];

  for (const match of matchLines(before, after)) {
    if (!match.before && match.after) {
      added.push(summarizeLine(match.after, match.key));
      continue;
    }
    if (match.before && !match.after) {
      removed.push(summarizeLine(match.before, match.key));
      continue;
    }
    const beforeLine = match.before!;
    const afterLine = match.after!;
    const beforeBalance = balanceMap(beforeLine);
    const afterBalance = balanceMap(afterLine);
    const items = new Set([...beforeBalance.keys(), ...afterBalance.keys()]);
    const rateDeltas = [...items]
      .map((itemId) => {
        const from = beforeBalance.get(itemId) ?? 0;
        const to = afterBalance.get(itemId) ?? 0;
        return { itemId, before: from, after: to, delta: round(to - from) };
      })
      .filter((delta) => Math.abs(delta.delta) > 1e-6)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    const beforeSummary = summarizeLine(beforeLine, match.key);
    const afterSummary = summarizeLine(afterLine, match.key);
    if (
      rateDeltas.length > 0 ||
      beforeSummary.buildingCount !== afterSummary.buildingCount ||
      beforeSummary.name !== afterSummary.name ||
      JSON.stringify(beforeSummary.balance) !== JSON.stringify(afterSummary.balance)
    ) {
      changed.push({
        key: match.key,
        name: afterSummary.name,
        before: beforeSummary,
        after: afterSummary,
        rateDeltas,
      });
    }
  }

  return { added, removed, changed };
};

const findBuildingChanges = (
  before: Building[],
  after: Building[],
): { added: Building[]; removed: Building[]; changed: BuildingChange[] } => {
  const beforeMap = new Map(before.map((building) => [building.id, building]));
  const afterMap = new Map(after.map((building) => [building.id, building]));
  const added = after.filter((building) => !beforeMap.has(building.id));
  const removed = before.filter((building) => !afterMap.has(building.id));
  const changed: BuildingChange[] = [];

  for (const building of after) {
    const previous = beforeMap.get(building.id);
    if (!previous) continue;
    const fields: BuildingChange['fields'] = [];
    if (previous.typeId !== building.typeId) fields.push('typeId');
    if (previous.recipeId !== building.recipeId) fields.push('recipeId');
    if (Math.abs(previous.clock - building.clock) > 1e-6) fields.push('clock');
    if (Math.abs(previous.boost - building.boost) > 1e-6) fields.push('boost');
    if (fields.length > 0) changed.push({ id: building.id, before: previous, after: building, fields });
  }

  return {
    added: added.sort((a, b) => a.id.localeCompare(b.id)),
    removed: removed.sort((a, b) => a.id.localeCompare(b.id)),
    changed: changed.sort((a, b) => a.id.localeCompare(b.id)),
  };
};

const findingKey = (finding: Finding): string =>
  [
    finding.kind,
    finding.lineId ?? '',
    finding.itemId ?? '',
    [...(finding.buildingIds ?? [])].sort().join(','),
  ].join('|');

const diffFindings = (before: Finding[], after: Finding[]) => {
  const beforeKeys = new Set(before.map(findingKey));
  const afterKeys = new Set(after.map(findingKey));
  return {
    added: after.filter((finding) => !beforeKeys.has(findingKey(finding))),
    resolved: before.filter((finding) => !afterKeys.has(findingKey(finding))),
  };
};

export interface DiffMeta {
  beforeLabel?: string;
  afterLabel?: string;
  beforeCreatedAt?: string;
  afterCreatedAt?: string;
}

export const diffModels = (
  before: NormalizedSave,
  after: NormalizedSave,
  meta: DiffMeta = {},
): ModelDiff => {
  const beforeAnalysis = analyzeModel(before);
  const afterAnalysis = analyzeModel(after);
  return {
    from: {
      label: meta.beforeLabel ?? before.source.fileName,
      createdAt: meta.beforeCreatedAt ?? before.importedAt,
    },
    to: {
      label: meta.afterLabel ?? after.source.fileName,
      createdAt: meta.afterCreatedAt ?? after.importedAt,
    },
    buildings: findBuildingChanges(before.buildings, after.buildings),
    lines: lineChanges(beforeAnalysis.supplyLines, afterAnalysis.supplyLines),
    power: {
      before: before.power,
      after: after.power,
      generationDelta: round(after.power.generation - before.power.generation),
      consumptionDelta: round(after.power.consumption - before.power.consumption),
      headroomDelta: round(after.power.headroom - before.power.headroom),
    },
    coverage: {
      before: before.coverage,
      after: after.coverage,
      ratioDelta: round(after.coverage.ratio - before.coverage.ratio, 4),
      modeledDelta: after.coverage.modeledBuildings - before.coverage.modeledBuildings,
    },
    findings: diffFindings(beforeAnalysis.findings, afterAnalysis.findings),
  };
};

export const diffCheckpoints = (before: CheckpointRecord, after: CheckpointRecord): ModelDiff =>
  diffModels(before.model, after.model, {
    beforeLabel: before.label,
    afterLabel: after.label,
    beforeCreatedAt: before.createdAt,
    afterCreatedAt: after.createdAt,
  });
