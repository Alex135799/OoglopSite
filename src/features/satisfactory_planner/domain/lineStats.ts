import type { NormalizedSave, ProductionLine } from './types';

export interface LineStatsLine {
  id: string;
  name: string;
  buildingIds: string[];
}

export interface LineStats {
  activeLines: LineStatsLine[];
  buildingsInLines: number;
  totalModeled: number;
  totalCandidates: number;
  flows: number;
  ratio: number;
}

export const getLineStats = (
  model: Pick<NormalizedSave, 'lines' | 'buildings'>,
): LineStats => {
  const modeledIds = new Set(
    model.buildings.filter((building) => building.modeled).map((building) => building.id),
  );
  const identifiedIds = new Set(
    model.buildings
      .filter((building) => building.modeled || building.knownType)
      .map((building) => building.id),
  );
  const activeLines = model.lines.filter((line) => line.buildingIds.length > 1);
  const inLines = new Set<string>();
  for (const line of activeLines) {
    for (const id of line.buildingIds) {
      if (identifiedIds.has(id)) inLines.add(id);
    }
  }
  const flows = activeLines.reduce((total, line) => total + line.flows.length, 0);
  const totalCandidates = model.buildings.length;
  return {
    activeLines,
    buildingsInLines: inLines.size,
    totalModeled: modeledIds.size,
    totalCandidates,
    flows,
    ratio: totalCandidates === 0 ? 0 : inLines.size / totalCandidates,
  };
};
