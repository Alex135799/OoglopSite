import { describe, expect, it } from 'vitest';
import { buildLines } from '../domain/buildLines';
import { building, rates } from './helpers';

describe('buildLines', () => {
  it('keeps unmodeled buildings as unknown lines when nothing is modeled', () => {
    const lines = buildLines([building('A', { modeled: false, displayName: 'Idle' })]);
    expect(lines).toEqual([
      {
        id: 'line-1',
        name: 'Idle (unknown)',
        outputItems: [],
        buildingIds: ['A'],
        flows: [],
        balance: [],
      },
    ]);
    expect(buildLines([])).toEqual([]);
  });

  it('connects producers to consumers and keeps a single component', () => {
    const lines = buildLines(
      [
        building('A', { outputs: rates({ Plate: 60 }) }),
        building('B', { inputs: rates({ Plate: 30 }) }),
        building('C', { inputs: rates({ Plate: 60 }) }),
      ],
      { itemName: (item) => item.toUpperCase() },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0].buildingIds).toEqual(['A', 'B', 'C']);
    expect(lines[0].flows).toEqual([
      { from: 'A', to: 'B', itemId: 'Plate', rate: 20 },
      { from: 'A', to: 'C', itemId: 'Plate', rate: 40 },
    ]);
    expect(lines[0].balance).toEqual([
      { itemId: 'Plate', supply: 60, demand: 90 },
    ]);
    expect(lines[0].name).toBe('PLATE line');
  });

  it('keeps isolated modeled buildings as single-node lines', () => {
    const lines = buildLines([
      building('A', { displayName: 'Constructor', outputs: rates({ X: 10 }) }),
      building('B', { displayName: 'Smelter', inputs: rates({ X: 10 }) }),
      building('C', { displayName: 'Isolated' }),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0].buildingIds).toEqual(['A', 'B']);
    expect(lines[1].buildingIds).toEqual(['C']);
    expect(lines[1].name).toBe('Isolated (unlinked)');
  });

  it('does not create self-edges for recipes that consume their own output', () => {
    const lines = buildLines([
      building('A', {
        inputs: rates({ Fuel: 10 }),
        outputs: rates({ Fuel: 50 }),
      }),
    ]);
    expect(lines[0].flows).toEqual([]);
    expect(lines[0].balance).toEqual([{ itemId: 'Fuel', supply: 50, demand: 10 }]);
    expect(lines[0].outputItems).toEqual(['Fuel']);
  });

  it('names lines from up to two surplus items and marks extras', () => {
    const lines = buildLines(
      [
        building('A', { outputs: rates({ A: 30, B: 20, C: 10 }) }),
        building('B', { inputs: rates({ A: 1 }) }),
      ],
      { itemName: (item) => `Item ${item}` },
    );
    expect(lines[0].name).toBe('Item B + Item C line');
  });

  it('leaves surplus without a consumer as an output item', () => {
    const lines = buildLines([
      building('A', { outputs: rates({ A: 30, B: 10 }) }),
      building('B', { inputs: rates({ A: 5 }) }),
    ]);
    expect(lines[0].outputItems).toEqual(['A', 'B']);
    expect(lines[0].balance).toEqual([
      { itemId: 'A', supply: 30, demand: 5 },
      { itemId: 'B', supply: 10, demand: 0 },
    ]);
  });

  it('ignores zero and negative rates', () => {
    const lines = buildLines([
      building('A', { outputs: rates({ A: 0, B: -5, C: 10 }) }),
      building('B', { inputs: rates({ C: 10, D: 0, E: -5 }) }),
    ]);
    expect(lines[0].balance).toEqual([{ itemId: 'C', supply: 10, demand: 10 }]);
  });

  it('allocates across multiple producers deterministically', () => {
    const lines = buildLines([
      building('B', { outputs: rates({ Plate: 40 }) }),
      building('A', { outputs: rates({ Plate: 30 }) }),
      building('C', { inputs: rates({ Plate: 50 }) }),
    ]);
    expect(lines[0].flows).toEqual([
      { from: 'A', to: 'C', itemId: 'Plate', rate: 21.4286 },
      { from: 'B', to: 'C', itemId: 'Plate', rate: 28.5714 },
    ]);
  });

  it('keeps demand-only components and sorts equal output items by id', () => {
    const lines = buildLines([
      building('A', { inputs: rates({ OnlyInput: 10 }) }),
      building('B', { outputs: rates({ Zed: 10, Alpha: 10 }) }),
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].balance).toEqual([{ itemId: 'OnlyInput', supply: 0, demand: 10 }]);
    expect(lines[0].outputItems).toEqual([]);
    expect(lines[0].name).toBe('Constructor (unlinked)');
    expect(lines[1].outputItems).toEqual(['Alpha', 'Zed']);
  });

  it('attaches physically connected unmodeled buildings to their modeled line', () => {
    const lines = buildLines([
      building('A', { outputs: rates({ Plate: 60 }), physicalGroup: 'factory-1' }),
      building('B', { inputs: rates({ Plate: 30 }), physicalGroup: 'factory-1' }),
      building('U', {
        modeled: false,
        displayName: 'Idle',
        physicalGroup: 'factory-1',
        inputs: rates({ unknown: 0 }),
        outputs: rates({ unknown: 0 }),
      }),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].buildingIds).toEqual(['A', 'B', 'U']);
    expect(lines[0].flows).toContainEqual({
      from: 'A',
      to: 'U',
      itemId: 'unknown',
      rate: 0,
    });
    expect(lines[0].balance).toEqual([{ itemId: 'Plate', supply: 60, demand: 30 }]);
  });

  it('groups unconnected unmodeled buildings into separate unknown lines', () => {
    const lines = buildLines([
      building('U1', { modeled: false, displayName: 'Idle One' }),
      building('U2', { modeled: false, displayName: 'Idle Two' }),
    ]);
    expect(lines.map((line) => line.name)).toEqual(['Idle One (unknown)', 'Idle Two (unknown)']);
  });
});
