import type { SupplyLineModel } from '../domain/types';
import type { GraphEdge } from './lineGraphLayout';

export interface ProductionGroup {
  id: string;
  key: string;
  tier: number;
  buildingIds: string[];
  upstreamBuildingIds: string[];
  upstreamGroupIds: string[];
}

const productionNode = (node: SupplyLineModel['nodes'][string] | undefined) =>
  node?.type === 'source' || node?.type === 'transformer';

const stableUpstream = (line: SupplyLineModel, edges: GraphEdge[]) => {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge.from);
    incoming.set(edge.to, list);
  }
  const productionIds = new Set(
    Object.values(line.nodes)
      .filter((node) => productionNode(node))
      .map((node) => node.id),
  );

  const cache = new Map<string, string[]>();
  const upstreamOf = (id: string, visiting = new Set<string>()): string[] => {
    const cached = cache.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return [];
    const nextVisiting = new Set(visiting).add(id);
    const result = new Set<string>();
    for (const from of incoming.get(id) ?? []) {
      if (productionIds.has(from)) {
        result.add(from);
        continue;
      }
      if (line.nodes[from]?.type === 'control') {
        for (const upstream of upstreamOf(from, nextVisiting)) result.add(upstream);
      }
    }
    const value = [...result].sort();
    cache.set(id, value);
    return value;
  };
  return { upstreamOf, productionIds };
};

export const buildProductionGroups = (
  line: SupplyLineModel,
  edges: GraphEdge[],
): ProductionGroup[] => {
  const { upstreamOf } = stableUpstream(line, edges);
  const productionNodes = Object.values(line.nodes).filter((node) => productionNode(node));
  const tierCache = new Map<string, number>();
  const tierOf = (id: string, visiting = new Set<string>()): number => {
    const cached = tierCache.get(id);
    if (cached !== undefined) return cached;
    const node = line.nodes[id];
    if (!node || node.type === 'source') {
      tierCache.set(id, 0);
      return 0;
    }
    if (visiting.has(id)) return 1;
    const nextVisiting = new Set(visiting).add(id);
    const upstream = upstreamOf(id);
    const tier = upstream.length === 0
      ? 1
      : 1 + Math.max(...upstream.map((upstreamId) => tierOf(upstreamId, nextVisiting)));
    tierCache.set(id, tier);
    return tier;
  };

  const keyFor = (id: string): string => {
    const node = line.nodes[id];
    if (!node) return `unknown:${id}`;
    if (node.type === 'source') {
      return `source:${node.displayName}:${node.outputs.map((port) => port.itemId).sort().join(',')}`;
    }
    if (node.type !== 'transformer') return `control:${id}`;
    const recipe = node.recipeId ?? `${node.kind}:${node.displayName}`;
    return `recipe:${recipe}:${upstreamOf(id).join('|')}`;
  };

  const groups = new Map<string, ProductionGroup>();
  for (const node of productionNodes.sort((a, b) => a.id.localeCompare(b.id))) {
    const key = keyFor(node.id);
    const existing = groups.get(key);
    if (existing) {
      existing.buildingIds.push(node.id);
      existing.tier = Math.max(existing.tier, tierOf(node.id));
      continue;
    }
    groups.set(key, {
      id: key,
      key,
      tier: tierOf(node.id),
      buildingIds: [node.id],
      upstreamBuildingIds: upstreamOf(node.id),
      upstreamGroupIds: [],
    });
  }

  const buildingGroup = new Map<string, string>();
  for (const group of groups.values()) {
    for (const id of group.buildingIds) buildingGroup.set(id, group.id);
  }
  for (const group of groups.values()) {
    group.upstreamGroupIds = [...new Set(
      group.upstreamBuildingIds
        .map((id) => buildingGroup.get(id))
        .filter((value): value is string => Boolean(value)),
    )].sort();
  }
  return [...groups.values()].sort(
    (a, b) => a.tier - b.tier || a.key.localeCompare(b.key),
  );
};

const nearestFreeRow = (
  used: Set<number>,
  desired: number,
  limit: number,
): number => {
  const target = Math.max(0, Math.round(desired));
  for (let offset = 0; offset <= limit; offset += 1) {
    if (!used.has(target + offset)) return target + offset;
    if (target - offset >= 0 && !used.has(target - offset)) return target - offset;
  }
  return limit + 1;
};

export const assignGroupRows = (
  groups: ProductionGroup[],
): Map<string, number> => {
  const rows = new Map<string, number>();
  const usedByTier = new Map<number, Set<number>>();
  const byId = new Map(groups.map((group) => [group.id, group]));
  const desired = (group: ProductionGroup, direction: 'up' | 'down'): number => {
    const ids = direction === 'up' ? group.upstreamGroupIds : [];
    const values = ids
      .map((id) => rows.get(id))
      .filter((value): value is number => value !== undefined);
    return values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : rows.get(group.id) ?? group.tier;
  };

  const assignTier = (tier: number, direction: 'up' | 'down') => {
    const tierGroups = groups
      .filter((group) => group.tier === tier)
      .sort(
        (a, b) =>
          desired(a, direction) - desired(b, direction) || a.key.localeCompare(b.key),
      );
    const used = usedByTier.get(tier) ?? new Set<number>();
    usedByTier.set(tier, used);
    for (const group of tierGroups) {
      const row = nearestFreeRow(used, desired(group, direction), groups.length + 2);
      rows.set(group.id, row);
      used.add(row);
    }
  };

  const tiers = [...new Set(groups.map((group) => group.tier))].sort((a, b) => a - b);
  for (const tier of tiers) assignTier(tier, 'up');

  const downstream = new Map<string, string[]>();
  for (const group of groups) {
    for (const upstreamId of group.upstreamGroupIds) {
      const list = downstream.get(upstreamId) ?? [];
      list.push(group.id);
      downstream.set(upstreamId, list);
    }
  }
  const desiredDown = (group: ProductionGroup): number => {
    const values = (downstream.get(group.id) ?? [])
      .map((id) => rows.get(id))
      .filter((value): value is number => value !== undefined);
    if (values.length === 0) return rows.get(group.id) ?? group.tier;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  for (const tier of [...tiers].reverse()) {
    const tierGroups = groups
      .filter((group) => group.tier === tier)
      .sort((a, b) => desiredDown(a) - desiredDown(b) || a.key.localeCompare(b.key));
    const used = usedByTier.get(tier) ?? new Set<number>();
    used.clear();
    for (const group of tierGroups) {
      const row = nearestFreeRow(used, desiredDown(group), groups.length + 2);
      rows.set(group.id, row);
      used.add(row);
    }
  }
  // Final upstream alignment pass.
  for (const tier of tiers) assignTier(tier, 'up');
  void byId;
  return rows;
};
