import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LineGraph } from '../components/LineGraph';
import { building, line, rates } from './helpers';
import type { Finding } from '../domain/types';

const buildings = [
  building('A', { displayName: 'Constructor', recipeName: 'Iron Plate', outputs: rates({ Plate: 60 }) }),
  building('B', { displayName: 'Assembler', recipeName: 'Reinforced Plate', inputs: rates({ Plate: 60 }) }),
  building('C', { displayName: 'Isolated Smelter', typeId: 'Build_SmelterMk1_C' }),
];

const flowLine = line('line-1', ['A', 'B', 'C'], {
  name: 'Iron Plate line',
  outputItems: ['Plate'],
  flows: [{ from: 'A', to: 'B', itemId: 'Plate', rate: 60 }],
});

const findings: Finding[] = [
  {
    id: 'unmodeled:C',
    severity: 'warning',
    kind: 'unmodeled',
    message: 'C is unmodeled',
    buildingIds: ['C'],
  },
];

const map = new Map(buildings.map((entry) => [entry.id, entry]));

describe('LineGraph', () => {
  it('renders building nodes for the selected line', () => {
    render(
      <LineGraph
        line={flowLine}
        buildings={map}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.getByText('Constructor')).toBeInTheDocument();
    expect(screen.getByText('Assembler')).toBeInTheDocument();
    expect(screen.getByText('Isolated Smelter')).toBeInTheDocument();
  });

  it('filters to problem buildings and their neighbours', async () => {
    render(
      <LineGraph line={flowLine} buildings={map} findings={findings} onSelectBuilding={() => undefined} />,
    );
    await userEvent.click(screen.getByLabelText('Problems only'));
    expect(screen.getByText('Isolated Smelter')).toBeInTheDocument();
    expect(screen.queryByText('Constructor')).not.toBeInTheDocument();
  });

  it('shows an empty state without a line', () => {
    render(<LineGraph buildings={map} findings={[]} onSelectBuilding={() => undefined} />);
    expect(screen.getByText('Select a supply line to see its flow graph.')).toBeInTheDocument();
  });

  it('calls back when a node is selected', async () => {
    const onSelect = vi.fn();
    render(
      <LineGraph line={flowLine} buildings={map} findings={[]} onSelectBuilding={onSelect} />,
    );
    fireEvent.click(screen.getByText('Constructor'));
    expect(onSelect).toHaveBeenCalledWith('A');
  });

  it('renders an actual splitter between its upstream and downstream buildings', () => {
    const splitLine = line('line-split', ['A', 'B', 'C'], {
      name: 'Split line',
      outputItems: ['Plate'],
      flows: [
        { from: 'A', to: 'B', itemId: 'Plate', rate: 30 },
        { from: 'A', to: 'C', itemId: 'Plate', rate: 30 },
      ],
    });
    render(
      <LineGraph
        line={splitLine}
        buildings={map}
        splitters={[
          {
            id: 'splitter-1',
            typeId: 'Build_ConveyorAttachmentSplitter_C',
            inputs: ['A'],
            outputs: ['B', 'C'],
          },
        ]}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.getAllByText('S')).toHaveLength(1);
  });
});
