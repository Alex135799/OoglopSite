import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LineList } from '../components/LineList';
import { FindingsPanel } from '../components/FindingsPanel';
import { BuildingDetails } from '../components/BuildingDetails';
import { DiffView } from '../components/DiffView';
import { diffModels } from '../domain/diffModels';
import type { Finding, SupplyControlNode } from '../domain/types';
import { building, line, model, rates } from './helpers';

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: 'line:line-1:deficit:Desc_IronPlate_C',
  severity: 'critical',
  kind: 'line_deficit',
  message: 'Iron Plate shortfall',
  lineId: 'line-1',
  itemId: 'Desc_IronPlate_C',
  buildingIds: ['A'],
  required: 90,
  available: 60,
  unit: 'items/min',
  ...overrides,
});

describe('LineList', () => {
  it('shows an empty state', () => {
    render(<LineList lines={[]} findings={[]} onSelect={() => undefined} />);
    expect(screen.getByText('No connected supply lines yet.')).toBeInTheDocument();
  });

  it('renders line names, items, deficits and severity, and selects a line', async () => {
    const lines = [
      line('line-1', ['A', 'B'], {
        name: 'Iron Plate line',
        outputItems: ['Desc_IronPlate_C', 'Desc_IronRod_C', 'Desc_Wire_C', 'Desc_Cable_C'],
        balance: [{ itemId: 'Desc_IronPlate_C', supply: 60, demand: 90 }],
      }),
      line('line-2', ['C'], { name: 'Wire line', outputItems: ['Desc_Wire_C'] }),
    ];
    const onSelect = vi.fn();
    render(
      <LineList
        lines={lines}
        findings={[finding()]}
        selectedLineId="line-1"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Iron Plate line')).toBeInTheDocument();
    expect(screen.getByText('Iron Plate')).toBeInTheDocument();
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText(/60 \/ 90/)).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();

    await userEvent.click(screen.getByText('Wire line'));
    expect(onSelect).toHaveBeenCalledWith('line-2');
  });

  it('renders long lists progressively', async () => {
    const lines = Array.from({ length: 45 }, (_, index) =>
      line(`line-${index + 1}`, ['A'], { name: `Line ${index + 1}` }),
    );
    render(<LineList lines={lines} findings={[]} onSelect={() => undefined} />);
    expect(screen.queryByText('Line 45')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 45 lines' }));
    expect(screen.getByText('Line 45')).toBeInTheDocument();
  });
});

describe('FindingsPanel', () => {
  it('shows an empty state', () => {
    render(<FindingsPanel findings={[]} />);
    expect(screen.getByText('No estimated bottlenecks found.')).toBeInTheDocument();
  });

  it('shows numbers and building links', async () => {
    const onSelect = vi.fn();
    render(
      <FindingsPanel
        findings={[
          finding({ buildingIds: ['A', 'B', 'C', 'D', 'E'] }),
          finding({
            id: 'info',
            severity: 'info',
            kind: 'line_surplus',
            message: 'Surplus',
            required: undefined,
            available: undefined,
            unit: undefined,
            buildingIds: undefined,
          }),
        ]}
        onSelectBuilding={onSelect}
      />,
    );
    expect(screen.getByText('required 90')).toBeInTheDocument();
    expect(screen.getByText('available 60')).toBeInTheDocument();
    expect(screen.getByText('items/min')).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    await userEvent.click(buttons[0]);
    expect(onSelect).toHaveBeenCalledWith('A');
  });
});

describe('BuildingDetails', () => {
  it('prompts for a selection', () => {
    render(<BuildingDetails onClose={() => undefined} />);
    expect(screen.getByText(/Select a building/)).toBeInTheDocument();
  });

  it('renders a modeled building with inputs, outputs, notes and close action', async () => {
    const onClose = vi.fn();
    render(
      <BuildingDetails
        building={building('Build_A', {
          displayName: 'Constructor',
          recipeId: 'Recipe_IronPlate_C',
          recipeName: 'Iron Plate',
          clock: 1.5,
          boost: 0.5,
          shards: 2,
          inputs: rates({ Desc_IronIngot_C: 67.5 }),
          outputs: rates({ Desc_IronPlate_C: 45 }),
          powerConsumption: 15.38,
          notes: ['Variable recipe power: using the maximum estimate.'],
          location: { x: 1, y: 2, z: 3 },
        })}
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Constructor')).toBeInTheDocument();
    expect(screen.getByText('150%')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('15.4 MW')).toBeInTheDocument();
    expect(screen.getByText('67.5 items/min')).toBeInTheDocument();
    expect(screen.getByText('45 items/min')).toBeInTheDocument();
    expect(screen.getByText('1, 2, 3')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('renders control inputs, outputs and bottleneck reduction', async () => {
    const onClose = vi.fn();
    const splitter: SupplyControlNode = {
      id: 'Build_Splitter_1',
      type: 'control',
      kind: 'splitter',
      displayName: 'Splitter',
      itemId: 'Desc_OreIron_C',
      inputs: [
        { id: 'in', itemId: 'Desc_OreIron_C', expectedRate: 0, actualRate: 120 },
      ],
      outputs: [
        { id: 'out-1', itemId: 'Desc_OreIron_C', expectedRate: 0, actualRate: 40 },
        { id: 'out-2', itemId: 'Desc_OreIron_C', expectedRate: 0, actualRate: 30 },
      ],
      expectedThroughput: 120,
      actualThroughput: 120,
      bottleneck: true,
      notes: ['Output belts limit throughput.'],
    };
    render(<BuildingDetails supplyNode={splitter} onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Splitter' })).toBeInTheDocument();
    expect(screen.getAllByText('Iron Ore').length).toBeGreaterThan(0);
    expect(screen.getByText('Capacity reduction')).toBeInTheDocument();
    expect(screen.getAllByText('50 items/min').length).toBeGreaterThan(0);
    expect(screen.getByText(/Output belts reduce throughput by/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows base and boosted recipe ratios', () => {
    render(
      <BuildingDetails
        building={building('Build_Boosted', {
          displayName: 'Caterium Smelter',
          recipeId: 'Recipe_IngotCaterium_C',
          recipeName: 'Caterium Ingot',
          boost: 2,
          inputs: rates({ Desc_OreGold_C: 45 }),
          outputs: rates({ Desc_GoldIngot_C: 30 }),
          recipeInputs: [{ itemId: 'Desc_OreGold_C', amount: 3 }],
          recipeOutputs: [{ itemId: 'Desc_GoldIngot_C', amount: 1 }],
        })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('3 Caterium Ore → 1 Caterium Ingot')).toBeInTheDocument();
    expect(screen.getByText('3 Caterium Ore → 2 Caterium Ingot')).toBeInTheDocument();
    expect(screen.getByText('45 items/min')).toBeInTheDocument();
    expect(screen.getByText('30 items/min')).toBeInTheDocument();
  });

  it('marks unmodeled buildings and hides the recipe', () => {
    render(
      <BuildingDetails
        building={building('Build_Mod', { modeled: false, displayName: 'Mod Machine' })}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText('unmodeled')).toBeInTheDocument();
    expect(screen.getByText(/excluded from rate math/)).toBeInTheDocument();
    expect(screen.queryByText('Recipe')).not.toBeInTheDocument();
  });
});

describe('DiffView', () => {
  it('renders changes, deltas and findings', () => {
    const before = model({
      buildings: [building('A', { displayName: 'Constructor' }), building('B')],
      lines: [
        line('line-1', ['A'], {
          name: 'Plate line',
          outputItems: ['Desc_IronPlate_C'],
          balance: [{ itemId: 'Desc_IronPlate_C', supply: 60, demand: 30 }],
        }),
      ],
      findings: [finding({ id: 'old', message: 'Old problem', itemId: 'Desc_IronPlate_C' })],
    });
    const after = model({
      buildings: [
        building('A', { displayName: 'Constructor', clock: 2 }),
        building('C', { displayName: 'Assembler' }),
      ],
      lines: [
        line('line-2', ['A', 'C'], {
          name: 'Plate line',
          outputItems: ['Desc_IronPlate_C'],
          balance: [{ itemId: 'Desc_IronPlate_C', supply: 90, demand: 30 }],
        }),
      ],
      findings: [finding({ id: 'new', message: 'New problem', itemId: 'Desc_IronRod_C' })],
    });
    const diff = diffModels(before, after);
    render(<DiffView diff={diff} />);

    expect(screen.getByRole('heading', { name: /test.sav → test.sav/ })).toBeInTheDocument();
    expect(screen.getByText('Building changes')).toBeInTheDocument();
    expect(screen.getByText('added')).toBeInTheDocument();
    expect(screen.getByText('removed')).toBeInTheDocument();
    expect(screen.getByText('clock')).toBeInTheDocument();
    expect(screen.getByText('Line changes')).toBeInTheDocument();
    expect(screen.getByText('60 → 90 (+30)')).toBeInTheDocument();
    expect(screen.getByText('Old problem')).toBeInTheDocument();
    expect(screen.getByText('New problem')).toBeInTheDocument();
  });

  it('renders empty diff sections', () => {
    const source = model();
    render(<DiffView diff={diffModels(source, source)} />);
    expect(screen.getByText('No building changes.')).toBeInTheDocument();
    expect(screen.getByText('No line changes.')).toBeInTheDocument();
    expect(screen.getByText('No finding changes.')).toBeInTheDocument();
  });

  it('renders added and removed lines and a headroom warning', () => {
    const before = model({
      power: {
        generation: 100,
        consumption: 50,
        headroom: 50,
        headroomRatio: 0.5,
        generators: 1,
        consumers: 1,
        unmodeledGenerators: 0,
      },
      lines: [
        line('line-1', ['A'], {
          name: 'Wire line',
          outputItems: ['Desc_Wire_C'],
        }),
      ],
    });
    const after = model({
      power: {
        generation: 50,
        consumption: 50,
        headroom: 0,
        headroomRatio: 0,
        generators: 1,
        consumers: 1,
        unmodeledGenerators: 0,
      },
      lines: [
        line('line-2', ['B'], {
          name: 'Rod line',
          outputItems: ['Desc_IronRod_C'],
        }),
      ],
    });
    render(<DiffView diff={diffModels(before, after)} />);
    expect(screen.getByText('Wire line')).toBeInTheDocument();
    expect(screen.getByText('Rod line')).toBeInTheDocument();
    expect(screen.getByText(/Headroom fell by 50 MW/)).toBeInTheDocument();
  });
});
