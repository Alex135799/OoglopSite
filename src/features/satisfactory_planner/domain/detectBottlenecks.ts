import type {
  Building,
  Finding,
  NormalizedSave,
  ProductionLine,
  Severity,
  SupplyLineModel,
} from './types';
import type { GameData } from '../api/gameData';

export type DetectableModel = Pick<NormalizedSave, 'buildings' | 'lines' | 'power'>;

const severityRank: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const unitFor = (data: GameData, itemId: string): string => {
  const form = data.items[itemId]?.form;
  return form === 'liquid' || form === 'gas' ? 'm³/min' : 'items/min';
};

const itemLabel = (data: GameData, itemId: string): string =>
  data.items[itemId]?.name ?? itemId;

const number = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const groupedUnmodeled = (
  buildings: Building[],
  data: GameData,
): Map<string, Building[]> => {
  const groups = new Map<string, Building[]>();
  for (const building of buildings) {
    if (building.modeled) continue;
    const idleMachine = data.machines[building.typeId] !== undefined && !building.recipeId;
    const key = idleMachine
      ? building.connected
        ? `idle:connected:${building.typeId}`
        : 'idle:unconnected'
      : building.recipeId
        ? `missing:${building.typeId}:${building.recipeId}`
        : `type:${building.typeId}`;
    const list = groups.get(key) ?? [];
    list.push(building);
    groups.set(key, list);
  }
  return groups;
};

const lineFindings = (
  lines: ProductionLine[],
  data: GameData,
): Finding[] => {
  const findings: Finding[] = [];
  for (const line of lines) {
    for (const entry of line.balance) {
      const unit = unitFor(data, entry.itemId);
      const label = itemLabel(data, entry.itemId);
      if (entry.demand > entry.supply + 1e-6) {
        const critical = entry.supply < entry.demand * 0.8;
        findings.push({
          id: `line:${line.id}:deficit:${entry.itemId}`,
          severity: critical ? 'critical' : 'warning',
          kind: 'line_deficit',
          message: `${label} shortfall in ${line.name}: supply ${number(entry.supply)} ${unit}, demand ${number(entry.demand)} ${unit}.`,
          lineId: line.id,
          buildingIds: line.buildingIds,
          itemId: entry.itemId,
          required: entry.demand,
          available: entry.supply,
          unit,
        });
      } else if (entry.demand > 0 && entry.supply > entry.demand * 1.2) {
        findings.push({
          id: `line:${line.id}:surplus:${entry.itemId}`,
          severity: 'info',
          kind: 'line_surplus',
          message: `${label} surplus in ${line.name}: supply ${number(entry.supply)} ${unit} vs demand ${number(entry.demand)} ${unit}.`,
          lineId: line.id,
          buildingIds: line.buildingIds,
          itemId: entry.itemId,
          required: entry.demand,
          available: entry.supply,
          unit,
        });
      }
    }
  }
  return findings;
};

const supplyLineFindings = (
  supplyLines: SupplyLineModel[],
  data: GameData,
): Finding[] => {
  const findings: Finding[] = [];
  for (const line of supplyLines) {
    let unknownItems = 0;
    for (const input of line.summary.inputs) {
      if (input.unknown) {
        unknownItems += 1;
        continue;
      }
      if (input.expectedRate > input.actualRate + 1e-6) {
        const critical = input.actualRate < input.expectedRate * 0.8;
        findings.push({
          id: `line:${line.id}:deficit:${input.itemId}`,
          severity: critical ? 'critical' : 'warning',
          kind: 'line_deficit',
          message: `${itemLabel(data, input.itemId)} shortfall in ${line.name}: expected ${number(input.expectedRate)} ${input.unit}, actual ${number(input.actualRate)} ${input.unit}.`,
          lineId: line.id,
          buildingIds: line.buildingIds,
          itemId: input.itemId,
          required: input.expectedRate,
          available: input.actualRate,
          unit: input.unit,
        });
      }
    }
    for (const output of line.summary.outputs) {
      if (output.unknown) {
        unknownItems += 1;
        continue;
      }
      if (output.expectedRate > output.actualRate + 1e-6) {
        findings.push({
          id: `line:${line.id}:shortfall:${output.itemId}`,
          severity: 'warning',
          kind: 'line_deficit',
          message: `${itemLabel(data, output.itemId)} production shortfall in ${line.name}: expected ${number(output.expectedRate)} ${output.unit}, actual ${number(output.actualRate)} ${output.unit}.`,
          lineId: line.id,
          buildingIds: line.buildingIds,
          itemId: output.itemId,
          required: output.expectedRate,
          available: output.actualRate,
          unit: output.unit,
        });
      }
    }
    if (unknownItems > 0) {
      findings.push({
        id: `line:${line.id}:unknown`,
        severity: 'info',
        kind: 'unmodeled',
        message: `${unknownItems} boundary item(s) in ${line.name} have unknown actual rates.`,
        lineId: line.id,
        buildingIds: line.buildingIds,
      });
    }

    const starved = line.summary.bottlenecks.filter((entry) =>
      entry.reason.includes('starvation'),
    );
    if (starved.length > 0) {
      findings.push({
        id: `line:${line.id}:starved`,
        severity: 'warning',
        kind: 'line_deficit',
        message: `${starved.length} transformer(s) in ${line.name} are starved of inputs.`,
        lineId: line.id,
        buildingIds: starved.map((entry) => entry.nodeId),
        required: starved.reduce((sum, entry) => sum + entry.expectedRate, 0),
        available: starved.reduce((sum, entry) => sum + entry.actualRate, 0),
      });
    }

    const unknownTransports = line.summary.bottlenecks.filter((entry) =>
      entry.reason.includes('Transport'),
    );
    if (unknownTransports.length > 0) {
      findings.push({
        id: `line:${line.id}:unknown-transports`,
        severity: 'info',
        kind: 'unmodeled',
        message: `${unknownTransports.length} transport segment(s) in ${line.name} have unknown capacity or item.`,
        lineId: line.id,
        buildingIds: unknownTransports.slice(0, 20).map((entry) => entry.nodeId),
      });
    }

    const limitedSplitters = line.summary.bottlenecks.filter(
      (entry) => entry.reason === 'Splitter output belts limit flow',
    );
    for (const entry of limitedSplitters) {
      const itemId = entry.itemId ?? 'unknown';
      const unit = itemId === 'unknown' ? 'items/min' : unitFor(data, itemId);
      const label = itemId === 'unknown' ? 'flow' : itemLabel(data, itemId);
      const shortId = entry.nodeId.split('.').pop() ?? entry.nodeId;
      findings.push({
        id: `line:${line.id}:splitter-bottleneck:${entry.nodeId}`,
        severity: 'warning',
        kind: 'splitter_bottleneck',
        message: `Splitter ${shortId} in ${line.name} is limited by its output belts: ${label} ${number(entry.actualRate)} of ${number(entry.expectedRate)} ${unit}.`,
        lineId: line.id,
        ...(entry.itemId ? { itemId: entry.itemId } : {}),
        required: entry.expectedRate,
        available: entry.actualRate,
        unit,
      });
    }
  }
  return findings;
};

export const detectBottlenecks = (
  model: DetectableModel,
  data: GameData,
  supplyLines?: SupplyLineModel[],
): Finding[] => {
  const findings: Finding[] = [];

  if (model.power.consumption > model.power.generation) {
    findings.push({
      id: 'power:deficit',
      severity: 'critical',
      kind: 'power_deficit',
      message: `Power deficit: ${number(model.power.consumption)} MW demand, ${number(model.power.generation)} MW modeled generation.`,
      required: model.power.consumption,
      available: model.power.generation,
      unit: 'MW',
    });
  } else if (
    model.power.generation > 0 &&
    model.power.headroomRatio < 0.1
  ) {
    findings.push({
      id: 'power:headroom',
      severity: 'warning',
      kind: 'power_deficit',
      message: `Power headroom is ${Math.round(model.power.headroomRatio * 100)}%: ${number(model.power.generation)} MW generated for ${number(model.power.consumption)} MW demand.`,
      required: model.power.consumption,
      available: model.power.generation,
      unit: 'MW',
    });
  }

  if (model.power.unmodeledGenerators > 0) {
    findings.push({
      id: 'power:unmodeled-generators',
      severity: 'info',
      kind: 'unmodeled',
      message: `${model.power.unmodeledGenerators} generator(s) are not modeled, so generation may be understated.`,
      unit: 'MW',
    });
  }

  findings.push(...(supplyLines ? supplyLineFindings(supplyLines, data) : lineFindings(model.lines, data)));

  for (const [key, group] of groupedUnmodeled(model.buildings, data)) {
    if (key === 'idle:unconnected') {
      findings.push({
        id: 'unmodeled:idle:unconnected',
        severity: 'info',
        kind: 'missing_recipe',
        message: `${group.length} idle machines with no active recipe and no belt or pipe connection.`,
        buildingIds: group.map((building) => building.id),
      });
      continue;
    }
    const count = group.length;
    const displayName = group[0].displayName;
    const typeId = group[0].typeId;
    const recipeId = group[0].recipeId;
    const knownMachine = data.machines[typeId] !== undefined;
    const knownExtractor = data.extractors[typeId] !== undefined;
    const idleMachine = knownMachine && !recipeId;
    const connected = group[0].connected === true;
    const message = recipeId
      ? `${count} × ${displayName} excluded from rates: recipe ${recipeId} is not in the ${data.gameVersion} dataset.`
      : idleMachine
        ? `${count} × ${displayName} idle with no active recipe and ${
            connected ? 'connected to a belt or pipe' : 'no belt or pipe connection'
          }; rates are not modeled.`
        : knownExtractor
          ? `${count} × ${displayName} excluded from rates: the extractor resource could not be resolved.`
          : `${count} × ${displayName} excluded from rates: building type ${typeId} is not modeled.`;
    findings.push({
      id: `unmodeled:${key}`,
      severity: recipeId || (idleMachine && connected) ? 'warning' : 'info',
      kind: recipeId || idleMachine ? 'missing_recipe' : 'unmodeled',
      message,
      buildingIds: group.map((building) => building.id),
    });
  }

  return findings.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.id.localeCompare(b.id),
  );
};

export const summarizeFindings = (findings: Finding[]) => ({
  critical: findings.filter((finding) => finding.severity === 'critical').length,
  warning: findings.filter((finding) => finding.severity === 'warning').length,
  info: findings.filter((finding) => finding.severity === 'info').length,
});
