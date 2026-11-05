import { describe, expect, it } from 'vitest';
import { diffCheckpoints, diffModels } from '../domain/diffModels';
import type { CheckpointRecord, Finding } from '../domain/types';
import { building, line, model } from './helpers';

const finding = (id: string, overrides: Partial<Finding> = {}): Finding => ({
  id,
  severity: 'warning',
  kind: 'line_deficit',
  message: id,
  ...overrides,
});

const power = (generation: number, consumption: number) => ({
  generation,
  consumption,
  headroom: generation - consumption,
  headroomRatio: generation > 0 ? (generation - consumption) / generation : 0,
  generators: 1,
  consumers: 1,
  unmodeledGenerators: 0,
});

describe('diffModels', () => {
  it('reports added, removed and changed buildings', () => {
    const before = model({
      buildings: [
        building('A', { clock: 1, recipeId: 'Recipe_A_C' }),
        building('B', { typeId: 'Build_SmelterMk1_C' }),
      ],
    });
    const after = model({
      buildings: [
        building('A', { clock: 2, recipeId: 'Recipe_A_C', boost: 0.5 }),
        building('C', { recipeId: 'Recipe_C_C' }),
      ],
    });

    const diff = diffModels(before, after);
    expect(diff.buildings.added.map((entry) => entry.id)).toEqual(['C']);
    expect(diff.buildings.removed.map((entry) => entry.id)).toEqual(['B']);
    expect(diff.buildings.changed).toHaveLength(1);
    expect(diff.buildings.changed[0]).toMatchObject({ id: 'A', fields: ['clock', 'boost'] });
  });

  it('matches lines by output signature and reports rate deltas', () => {
    const before = model({
      lines: [
        line('line-1', ['A'], {
          outputItems: ['Plate'],
          balance: [{ itemId: 'Plate', supply: 60, demand: 30 }],
        }),
        line('line-2', ['B'], {
          outputItems: ['Wire'],
          balance: [{ itemId: 'Wire', supply: 10, demand: 0 }],
        }),
      ],
    });
    const after = model({
      lines: [
        line('line-9', ['A', 'C'], {
          outputItems: ['Plate'],
          balance: [{ itemId: 'Plate', supply: 90, demand: 30 }],
        }),
        line('line-10', ['D'], {
          outputItems: ['Rod'],
          balance: [{ itemId: 'Rod', supply: 5, demand: 0 }],
        }),
      ],
    });

    const diff = diffModels(before, after);
    expect(diff.lines.added.map((entry) => entry.outputItems)).toEqual([['Rod']]);
    expect(diff.lines.removed.map((entry) => entry.outputItems)).toEqual([['Wire']]);
    expect(diff.lines.changed).toHaveLength(1);
    expect(diff.lines.changed[0]).toMatchObject({
      key: 'Plate#1',
      rateDeltas: [{ itemId: 'Plate', before: 60, after: 90, delta: 30 }],
    });
    expect(diff.lines.changed[0].after.buildingCount).toBe(2);
  });

  it('matches lines with the same output signature in order', () => {
    const before = model({
      lines: [
        line('line-1', ['A'], { name: 'Plate line', outputItems: ['Plate'], balance: [] }),
        line('line-2', ['B'], { name: 'Plate line', outputItems: ['Plate'], balance: [] }),
      ],
    });
    const after = model({
      lines: [
        line('line-3', ['A'], { name: 'Plate line', outputItems: ['Plate'], balance: [] }),
      ],
    });
    const diff = diffModels(before, after);
    expect(diff.lines.removed).toHaveLength(1);
    expect(diff.lines.removed[0].key).toBe('Plate#2');
    expect(diff.lines.changed).toHaveLength(0);
  });

  it('compares power, coverage and findings', () => {
    const before = model({
      power: power(100, 60),
      coverage: {
        totalBuildings: 4,
        modeledBuildings: 2,
        ratio: 0.5,
        unmodeledTypes: [],
      },
      findings: [finding('old', { itemId: 'A' }), finding('same', { itemId: 'C' })],
    });
    const after = model({
      power: power(150, 80),
      coverage: {
        totalBuildings: 5,
        modeledBuildings: 4,
        ratio: 0.8,
        unmodeledTypes: [],
      },
      findings: [finding('same', { itemId: 'C' }), finding('new', { itemId: 'B' })],
    });

    const diff = diffModels(before, after);
    expect(diff.power).toMatchObject({
      generationDelta: 50,
      consumptionDelta: 20,
      headroomDelta: 30,
    });
    expect(diff.coverage.ratioDelta).toBeCloseTo(0.3);
    expect(diff.coverage.modeledDelta).toBe(2);
    expect(diff.findings.added.map((entry) => entry.id)).toEqual(['new']);
    expect(diff.findings.resolved.map((entry) => entry.id)).toEqual(['old']);
  });

  it('uses checkpoint labels and timestamps', () => {
    const beforeModel = model();
    const afterModel = model();
    const checkpoint = (label: string, createdAt: string): CheckpointRecord => ({
      id: label,
      label,
      createdAt,
      saveHash: 'hash',
      model: beforeModel,
    });
    const diff = diffCheckpoints(
      checkpoint('Before', '2026-01-01T00:00:00.000Z'),
      { ...checkpoint('After', '2026-02-01T00:00:00.000Z'), model: afterModel },
    );
    expect(diff.from).toEqual({ label: 'Before', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(diff.to).toEqual({ label: 'After', createdAt: '2026-02-01T00:00:00.000Z' });
  });

  it('produces empty diffs for identical models', () => {
    const source = model({
      buildings: [building('A')],
      lines: [line('line-1', ['A'], { outputItems: ['X'] })],
    });
    const diff = diffModels(source, source);
    expect(diff.buildings).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.lines).toEqual({ added: [], removed: [], changed: [] });
    expect(diff.findings).toEqual({ added: [], resolved: [] });
  });

  it('detects type and recipe changes and sorts multiple entries', () => {
    const before = model({
      buildings: [
        building('A', { typeId: 'Build_ConstructorMk1_C', recipeId: 'Recipe_A_C' }),
        building('B', { recipeId: 'Recipe_B_C' }),
      ],
      lines: [
        line('line-1', ['A'], {
          name: 'Mixed line',
          outputItems: ['Plate'],
          balance: [
            { itemId: 'Plate', supply: 60, demand: 0 },
            { itemId: 'Rod', supply: 10, demand: 0 },
          ],
        }),
      ],
      findings: [
        { id: 'x', severity: 'info', kind: 'unmodeled', message: 'x', buildingIds: ['A'] },
      ],
    });
    const after = model({
      buildings: [
        building('A', { typeId: 'Build_AssemblerMk1_C', recipeId: 'Recipe_C_C' }),
        building('B', { recipeId: 'Recipe_D_C' }),
        building('C', { recipeId: 'Recipe_E_C' }),
      ],
      lines: [
        line('line-2', ['A', 'C'], {
          name: 'Mixed line',
          outputItems: ['Plate'],
          balance: [
            { itemId: 'Plate', supply: 90, demand: 0 },
            { itemId: 'Rod', supply: 5, demand: 0 },
          ],
        }),
      ],
      findings: [
        { id: 'y', severity: 'info', kind: 'unmodeled', message: 'y', buildingIds: ['B'] },
      ],
    });
    const diff = diffModels(before, after);
    expect(diff.buildings.changed.map((entry) => entry.fields)).toEqual([
      ['typeId', 'recipeId'],
      ['recipeId'],
    ]);
    expect(diff.buildings.added.map((entry) => entry.id)).toEqual(['C']);
    expect(diff.lines.changed[0].rateDeltas).toEqual([
      { itemId: 'Plate', before: 60, after: 90, delta: 30 },
      { itemId: 'Rod', before: 10, after: 5, delta: -5 },
    ]);
    expect(diff.findings.added.map((entry) => entry.id)).toEqual(['y']);
    expect(diff.findings.resolved.map((entry) => entry.id)).toEqual(['x']);
  });
});
