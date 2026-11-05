import type { Building, ItemRate, LineBalance, LineFlow, ProductionLine } from './types';
import { round } from './rateMath';

export interface BuildLinesOptions {
  itemName?: (itemId: string) => string;
}

interface Contribution {
  buildingId: string;
  rate: number;
}

const EPSILON = 1e-6;

const groupRates = (
  buildings: Building[],
  selector: (building: Building) => ItemRate[],
): Map<string, Contribution[]> => {
  const grouped = new Map<string, Contribution[]>();
  for (const building of buildings) {
    for (const rate of selector(building)) {
      if (rate.rate <= EPSILON) continue;
      const list = grouped.get(rate.itemId) ?? [];
      list.push({ buildingId: building.id, rate: rate.rate });
      grouped.set(rate.itemId, list);
    }
  }
  return grouped;
};

class UnionFind {
  private parent = new Map<string, string>();

  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }

  find(id: string): string {
    const seen: string[] = [];
    let current = id;
    for (;;) {
      const parent = this.parent.get(current);
      if (parent === undefined) {
        this.parent.set(current, current);
        break;
      }
      if (parent === current) break;
      seen.push(current);
      current = parent;
    }
    for (const node of seen) this.parent.set(node, current);
    return current;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

const allocateFlows = (buildings: Building[]): LineFlow[] => {
  const supply = groupRates(buildings, (building) => building.outputs);
  const demand = groupRates(buildings, (building) => building.inputs);
  const flows: LineFlow[] = [];

  for (const itemId of [...supply.keys()].sort()) {
    const consumers = demand.get(itemId);
    if (!consumers || consumers.length === 0) continue;

    const producers = [...supply.get(itemId)!].sort((a, b) =>
      a.buildingId.localeCompare(b.buildingId),
    );
    const sinks = [...consumers].sort((a, b) => a.buildingId.localeCompare(b.buildingId));
    const totalSupply = producers.reduce((total, entry) => total + entry.rate, 0);
    const totalDemand = sinks.reduce((total, entry) => total + entry.rate, 0);
    const supplyScale = totalSupply > totalDemand ? totalDemand / totalSupply : 1;
    const demandScale = totalSupply < totalDemand ? totalSupply / totalDemand : 1;
    const remainingSupply = producers.map((entry) => entry.rate * supplyScale);
    const remainingDemand = sinks.map((entry) => entry.rate * demandScale);
    let producerIndex = 0;
    let sinkIndex = 0;

    while (producerIndex < producers.length && sinkIndex < sinks.length) {
      const producer = producers[producerIndex];
      const sink = sinks[sinkIndex];
      const rate = Math.min(remainingSupply[producerIndex], remainingDemand[sinkIndex]);
      remainingSupply[producerIndex] -= rate;
      remainingDemand[sinkIndex] -= rate;

      if (producer.buildingId !== sink.buildingId) {
        flows.push({
          from: producer.buildingId,
          to: sink.buildingId,
          itemId,
          rate: round(rate),
        });
      }

      if (remainingSupply[producerIndex] <= EPSILON) producerIndex += 1;
      if (remainingDemand[sinkIndex] <= EPSILON) sinkIndex += 1;
    }
  }

  flows.sort(
    (a, b) =>
      a.itemId.localeCompare(b.itemId) ||
      a.from.localeCompare(b.from) ||
      a.to.localeCompare(b.to),
  );
  return flows;
};

const balancesFor = (buildings: Building[]): LineBalance[] => {
  const supply = new Map<string, number>();
  const demand = new Map<string, number>();
  for (const building of buildings) {
    for (const output of building.outputs) {
      if (output.rate <= EPSILON) continue;
      supply.set(output.itemId, (supply.get(output.itemId) ?? 0) + output.rate);
    }
    for (const input of building.inputs) {
      if (input.rate <= EPSILON) continue;
      demand.set(input.itemId, (demand.get(input.itemId) ?? 0) + input.rate);
    }
  }
  const items = new Set([...supply.keys(), ...demand.keys()]);
  return [...items]
    .map((itemId) => ({
      itemId,
      supply: round(supply.get(itemId) ?? 0),
      demand: round(demand.get(itemId) ?? 0),
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
};

export const buildLines = (
  buildings: Building[],
  options: BuildLinesOptions = {},
): ProductionLine[] => {
  const modeled = buildings.filter((building) => building.modeled);
  const unmodeled = buildings.filter((building) => !building.modeled);
  const byId = new Map(buildings.map((building) => [building.id, building]));

  const flows = allocateFlows(modeled);
  const union = new UnionFind(modeled.map((building) => building.id));
  for (const flow of flows) union.union(flow.from, flow.to);

  const components = new Map<string, Building[]>();
  for (const building of modeled) {
    const root = union.find(building.id);
    const list = components.get(root) ?? [];
    list.push(building);
    components.set(root, list);
  }

  const nameForItem = options.itemName ?? ((itemId: string) => itemId);
  const ordered = [...components.values()]
    .map((component) => component.sort((a, b) => a.id.localeCompare(b.id)))
    .sort((a, b) => a[0].id.localeCompare(b[0].id));

  const lines: ProductionLine[] = ordered.map((component, index) => {
    const ids = new Set(component.map((building) => building.id));
    const balance = balancesFor(component);
    const outputItems = balance
      .filter((entry) => entry.supply > EPSILON)
      .sort((a, b) => b.supply - a.supply || a.itemId.localeCompare(b.itemId))
      .map((entry) => entry.itemId);
    const componentFlows = flows.filter(
      (flow) => ids.has(flow.from) && ids.has(flow.to),
    );

    const terminalItems = balance
      .filter((entry) => entry.supply > EPSILON && entry.demand <= EPSILON)
      .sort((a, b) => b.supply - a.supply || a.itemId.localeCompare(b.itemId))
      .map((entry) => entry.itemId);
    const nameItems = terminalItems.length > 0 ? terminalItems : outputItems;
    const names = nameItems.map(nameForItem);
    const name =
      names.length > 0
        ? `${names.slice(0, 2).join(' + ')}${names.length > 2 ? ' +…' : ''} line`
        : `${component[0].displayName} (unlinked)`;

    return {
      id: `line-${index + 1}`,
      name,
      outputItems,
      buildingIds: component.map((building) => building.id),
      flows: componentFlows,
      balance,
    };
  });

  const unassigned: Building[] = [];
  for (const building of unmodeled) {
    const candidates = building.physicalGroup
      ? lines
          .map((line) => ({
            line,
            matches: line.buildingIds.filter(
              (id) => byId.get(id)?.physicalGroup === building.physicalGroup,
            ).length,
          }))
          .filter((candidate) => candidate.matches > 0)
          .sort(
            (a, b) =>
              b.matches - a.matches || a.line.id.localeCompare(b.line.id),
          )
      : [];
    const match = candidates[0]?.line;
    if (!match) {
      unassigned.push(building);
      continue;
    }

    match.buildingIds.push(building.id);
    const peerId =
      match.buildingIds.find(
        (id) =>
          id !== building.id &&
          byId.get(id)?.modeled &&
          byId.get(id)?.physicalGroup === building.physicalGroup,
      ) ?? match.buildingIds.find((id) => id !== building.id && byId.get(id)?.modeled);
    if (peerId) {
      match.flows.push({
        from: peerId,
        to: building.id,
        itemId: 'unknown',
        rate: 0,
      });
    }
  }

  const groups = new Map<string, Building[]>();
  for (const building of unassigned) {
    const key = building.physicalGroup ?? `solo:${building.id}`;
    const list = groups.get(key) ?? [];
    list.push(building);
    groups.set(key, list);
  }

  for (const group of groups.values()) {
    const component = group.sort((a, b) => a.id.localeCompare(b.id));
    const groupFlows: LineFlow[] = [];
    for (let index = 1; index < component.length; index += 1) {
      groupFlows.push({
        from: component[index - 1].id,
        to: component[index].id,
        itemId: 'unknown',
        rate: 0,
      });
    }
    lines.push({
      id: `line-${lines.length + 1}`,
      name: `${component[0].displayName} (unknown)`,
      outputItems: [],
      buildingIds: component.map((building) => building.id),
      flows: groupFlows,
      balance: [],
    });
  }

  return lines
    .map((line, index) => ({ ...line, id: `line-${index + 1}` }))
    .map((line) => ({
      ...line,
      flows: [...line.flows].sort(
        (a, b) =>
          a.itemId.localeCompare(b.itemId) ||
          a.from.localeCompare(b.from) ||
          a.to.localeCompare(b.to),
      ),
    }));
};
