import { describe, expect, it } from 'vitest';
import { detectBottlenecks, summarizeFindings } from '../domain/detectBottlenecks';
import { gameData } from '../api/gameData';
import { building, line, model } from './helpers';
import type { Finding } from '../domain/types';

const power = (generation: number, consumption: number) => ({
  generation,
  consumption,
  headroom: generation - consumption,
  headroomRatio: generation > 0 ? (generation - consumption) / generation : 0,
  generators: generation > 0 ? 1 : 0,
  consumers: consumption > 0 ? 1 : 0,
  unmodeledGenerators: 0,
});

const detect = (overrides: Parameters<typeof model>[0]) =>
  detectBottlenecks(model(overrides), gameData);

const kinds = (findings: Finding[]) => findings.map((finding) => finding.kind);

describe('detectBottlenecks', () => {
  it('reports a critical power deficit with the numbers used', () => {
    const findings = detect({ power: power(50, 100) });
    expect(findings[0]).toMatchObject({
      id: 'power:deficit',
      severity: 'critical',
      kind: 'power_deficit',
      required: 100,
      available: 50,
      unit: 'MW',
    });
    expect(findings[0].message).toContain('50 MW');
  });

  it('warns when power headroom is below ten percent', () => {
    const findings = detect({ power: power(100, 95) });
    expect(findings[0]).toMatchObject({ id: 'power:headroom', severity: 'warning' });
    expect(findings[0].message).toContain('5%');
  });

  it('does not report power problems when nothing is modeled', () => {
    expect(detect({ power: power(0, 0) })).toEqual([]);
  });

  it('reports unmodeled generators as an info finding', () => {
    const findings = detect({
      power: { ...power(0, 0), unmodeledGenerators: 2 },
    });
    expect(findings[0]).toMatchObject({
      id: 'power:unmodeled-generators',
      severity: 'info',
      kind: 'unmodeled',
    });
  });

  it('marks line deficits critical below 80 percent supply and warning above it', () => {
    const critical = detect({
      lines: [
        line('line-1', ['A'], {
          name: 'Iron line',
          balance: [{ itemId: 'Desc_IronIngot_C', supply: 50, demand: 100 }],
        }),
      ],
    });
    expect(critical.find((finding) => finding.kind === 'line_deficit')).toMatchObject({
      severity: 'critical',
      required: 100,
      available: 50,
      unit: 'items/min',
      lineId: 'line-1',
      itemId: 'Desc_IronIngot_C',
    });
    expect(critical[0].message).toContain('Iron Ingot shortfall');

    const warning = detect({
      lines: [
        line('line-1', ['A'], {
          name: 'Iron line',
          balance: [{ itemId: 'Desc_IronIngot_C', supply: 90, demand: 100 }],
        }),
      ],
    });
    expect(warning.find((finding) => finding.kind === 'line_deficit')?.severity).toBe('warning');
  });

  it('uses fluid units for liquid items', () => {
    const findings = detect({
      lines: [
        line('line-1', ['A'], {
          name: 'Water line',
          balance: [{ itemId: 'Desc_Water_C', supply: 100, demand: 200 }],
        }),
      ],
    });
    expect(findings[0].unit).toBe('m³/min');
  });

  it('reports surplus only above twenty percent', () => {
    const findings = detect({
      lines: [
        line('line-1', ['A'], {
          balance: [{ itemId: 'Desc_IronPlate_C', supply: 121, demand: 100 }],
        }),
        line('line-2', ['B'], {
          balance: [{ itemId: 'Desc_IronRod_C', supply: 120, demand: 100 }],
        }),
      ],
    });
    expect(kinds(findings)).toEqual(['line_surplus']);
    expect(findings[0].severity).toBe('info');
  });

  it('groups unmodeled buildings and marks missing recipes', () => {
    const findings = detect({
      buildings: [
        building('A', { modeled: false, displayName: 'Mod Machine', typeId: 'Build_Mod_C', recipeId: 'Recipe_No_C' }),
        building('B', { modeled: false, displayName: 'Mod Machine', typeId: 'Build_Mod_C', recipeId: 'Recipe_No_C' }),
        building('C', { modeled: false, displayName: 'Mystery', typeId: 'Build_Mystery_C' }),
        building('D', { modeled: true }),
      ],
    });

    const unmodeled = findings.filter((finding) => finding.kind === 'unmodeled');
    const missing = findings.filter((finding) => finding.kind === 'missing_recipe');
    expect(unmodeled).toHaveLength(1);
    expect(unmodeled[0]).toMatchObject({
      severity: 'info',
      buildingIds: ['C'],
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      severity: 'warning',
      buildingIds: ['A', 'B'],
    });
    expect(missing[0].message).toContain('2 × Mod Machine');
  });

  it('summarizes findings by severity', () => {
    expect(
      summarizeFindings([
        { id: 'a', severity: 'critical', kind: 'power_deficit', message: '' },
        { id: 'b', severity: 'warning', kind: 'line_deficit', message: '' },
        { id: 'c', severity: 'info', kind: 'line_surplus', message: '' },
        { id: 'd', severity: 'info', kind: 'unmodeled', message: '' },
      ]),
    ).toEqual({ critical: 1, warning: 1, info: 2 });
  });

  it('uses gas units and falls back to item ids', () => {
    const findings = detect({
      lines: [
        line('line-1', ['A'], {
          name: 'Gas line',
          balance: [
            { itemId: 'Desc_NitrogenGas_C', supply: 10, demand: 20 },
            { itemId: 'Desc_Unknown_C', supply: 1, demand: 2 },
          ],
        }),
      ],
    });
    const gas = findings.find((finding) => finding.itemId === 'Desc_NitrogenGas_C');
    const unknown = findings.find((finding) => finding.itemId === 'Desc_Unknown_C');
    expect(gas?.unit).toBe('m³/min');
    expect(gas?.message).toContain('Nitrogen Gas');
    expect(unknown?.unit).toBe('items/min');
    expect(unknown?.message).toContain('Desc_Unknown_C');
  });

  it('explains known machines without recipes and extractors without resources', () => {
    const findings = detect({
      buildings: [
        building('A', {
          modeled: false,
          displayName: 'Constructor',
          typeId: 'Build_ConstructorMk1_C',
        }),
        building('B', {
          modeled: false,
          displayName: 'Miner Mk.2',
          typeId: 'Build_MinerMk2_C',
        }),
      ],
    });
    expect(findings.find((finding) => finding.buildingIds?.includes('A'))?.message).toContain(
      'no active recipe',
    );
    expect(findings.find((finding) => finding.buildingIds?.includes('B'))?.message).toContain(
      'extractor resource could not be resolved',
    );
  });

  it('warns for connected idle machines and informs for unconnected idle machines', () => {
    const findings = detect({
      buildings: [
        building('A', {
          modeled: false,
          displayName: 'Constructor',
          typeId: 'Build_ConstructorMk1_C',
          connected: true,
        }),
        building('B', {
          modeled: false,
          displayName: 'Constructor',
          typeId: 'Build_ConstructorMk1_C',
        }),
      ],
    });
    const connected = findings.find((finding) => finding.buildingIds?.includes('A'));
    const unconnected = findings.find((finding) => finding.buildingIds?.includes('B'));
    expect(connected).toMatchObject({ severity: 'warning' });
    expect(connected?.message).toContain('connected to a belt or pipe');
    expect(unconnected).toMatchObject({ severity: 'info' });
    expect(unconnected?.message).toContain('no belt or pipe connection');
  });

  it('buckets all unconnected idle machines into one info finding', () => {
    const findings = detect({
      buildings: [
        building('A', {
          modeled: false,
          displayName: 'Assembler',
          typeId: 'Build_AssemblerMk1_C',
        }),
        building('B', {
          modeled: false,
          displayName: 'Blender',
          typeId: 'Build_Blender_C',
        }),
        building('C', {
          modeled: false,
          displayName: 'Constructor',
          typeId: 'Build_ConstructorMk1_C',
        }),
      ],
    });
    const idle = findings.filter((finding) => finding.kind === 'missing_recipe');
    expect(idle).toHaveLength(1);
    expect(idle[0]).toMatchObject({
      id: 'unmodeled:idle:unconnected',
      severity: 'info',
      buildingIds: ['A', 'B', 'C'],
    });
    expect(idle[0].message).toBe(
      '3 idle machines with no active recipe and no belt or pipe connection.',
    );
  });
});
