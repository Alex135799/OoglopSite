import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LineGraph } from '../components/LineGraph';
import { buildSupplyLineModel } from '../domain/buildSupplyLineModel';
import { gameData } from '../api/gameData';
import { building, line, model, rates } from './helpers';
import type { Finding, SupplyLineModel } from '../domain/types';

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

const supply = (
  sourceBuildings = buildings,
  sourceLine = flowLine,
  transportNodes: Parameters<typeof buildSupplyLineModel>[3]['transportNodes'] = [],
  transportRuns: Parameters<typeof buildSupplyLineModel>[3]['transportRuns'] = [],
) => {
  const sourceModel = model({ buildings: sourceBuildings, lines: [sourceLine] });
  return buildSupplyLineModel(sourceModel, sourceLine, gameData, {
    transportNodes,
    transportRuns,
  });
};

describe('LineGraph', () => {
  it('renders building nodes for the selected line', () => {
    render(
      <LineGraph
        line={supply()}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.getByText('Constructor')).toBeInTheDocument();
    expect(screen.getByText('Assembler')).toBeInTheDocument();
    expect(screen.getByText('Isolated Smelter')).toBeInTheDocument();
  });

  it('shows a boost label only for Somerslooped machines', () => {
    const boosted = building('Boosted', {
      displayName: 'Boosted Smelter',
      typeId: 'Build_SmelterMk1_C',
      boost: 2,
    });
    const boostedLine = line('line-boost', ['Boosted'], {
      name: 'Boosted line',
      flows: [],
    });
    const { rerender } = render(
      <LineGraph
        line={supply([boosted], boostedLine)}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.getByText('Boost +100%')).toBeInTheDocument();

    const normal = building('Normal', {
      displayName: 'Normal Smelter',
      typeId: 'Build_SmelterMk1_C',
    });
    const normalLine = line('line-normal', ['Normal'], {
      name: 'Normal line',
      flows: [],
    });
    rerender(
      <LineGraph
        line={supply([normal], normalLine)}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.queryByText(/Boost \+/)).not.toBeInTheDocument();
  });

  it('renders a target handle for every building input item', () => {
    const converter = building('Converter', {
      displayName: 'Converter',
      typeId: 'Build_Converter_C',
      recipeId: 'Recipe_FicsiteIngot_Iron_C',
      inputs: rates({ Desc_SAMIngot_C: 120, Desc_IronIngot_C: 720 }),
      outputs: rates({ Desc_FicsiteIngot_C: 30 }),
    });
    const converterLine = line('line-converter', ['Converter'], {
      name: 'Converter line',
      flows: [],
    });
    const { container } = render(
      <LineGraph
        line={supply([converter], converterLine)}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(container.querySelector('[data-handleid="in-Desc_SAMIngot_C"]')).toBeInTheDocument();
    expect(container.querySelector('[data-handleid="in-Desc_IronIngot_C"]')).toBeInTheDocument();
    expect(container.querySelector('[data-handleid="out-Desc_FicsiteIngot_C"]')).toBeInTheDocument();
  });

  it('filters to problem buildings and their neighbours', async () => {
    render(
      <LineGraph line={supply()} findings={findings} onSelectBuilding={() => undefined} />,
    );
    await userEvent.click(screen.getByLabelText('Problems only'));
    expect(screen.getByText('Isolated Smelter')).toBeInTheDocument();
    expect(screen.queryByText('Constructor')).not.toBeInTheDocument();
  });

  it('shows an empty state without a line', () => {
    render(<LineGraph findings={[]} onSelectBuilding={() => undefined} />);
    expect(screen.getByText('Select a supply line to see its flow graph.')).toBeInTheDocument();
  });

  it('calls back when a node is selected', async () => {
    const onSelect = vi.fn();
    render(
      <LineGraph line={supply()} findings={[]} onSelectBuilding={onSelect} />,
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
    const onSelect = vi.fn();
    render(
      <LineGraph
        line={supply(buildings, splitLine, [
          {
            id: 'splitter-1',
            typeId: 'Build_ConveyorAttachmentSplitter_C',
            kind: 'splitter',
            inputs: ['A'],
            outputs: ['B', 'C'],
          },
        ])}
        findings={[]}
        onSelectBuilding={onSelect}
      />,
    );
    expect(screen.getAllByText('S')).toHaveLength(1);
    fireEvent.click(screen.getByText('S'));
    expect(onSelect).toHaveBeenCalledWith('splitter-1');
  });

  it('renders an actual merger between its upstream and downstream buildings', () => {
    const mergeLine = line('line-merge', ['A', 'B', 'C'], {
      name: 'Merge line',
      outputItems: ['Plate'],
      flows: [
        { from: 'A', to: 'C', itemId: 'Plate', rate: 30 },
        { from: 'B', to: 'C', itemId: 'Plate', rate: 30 },
      ],
    });
    render(
      <LineGraph
        line={supply(buildings, mergeLine, [
          {
            id: 'merger-1',
            typeId: 'Build_ConveyorAttachmentMerger_C',
            kind: 'merger',
            inputs: ['A', 'B'],
            outputs: ['C'],
          },
        ])}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );
    expect(screen.getByText('M')).toBeInTheDocument();
    const nodePosition = (label: string) => {
      const node = screen.getByText(label).closest('.react-flow__node') as HTMLElement;
      const match = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
    };
    const merger = screen
      .getByText('M')
      .closest('.react-flow__node') as HTMLElement;
    const mergerMatch = merger.style.transform.match(
      /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/,
    );
    const mergerPosition = mergerMatch
      ? { x: Number(mergerMatch[1]), y: Number(mergerMatch[2]) }
      : undefined;
    const producerA = nodePosition('Constructor');
    const producerB = nodePosition('Assembler');
    expect(mergerPosition && producerA && producerB).toBeTruthy();
    expect(mergerPosition!.x).toBeGreaterThan(producerA!.x);
    expect(mergerPosition!.x).toBeGreaterThan(producerB!.x);
  });

  it('marks a bottleneck splitter with a warning label', () => {
    const bottleneckLine: SupplyLineModel = {
      id: 'line-bottleneck',
      name: 'Bottleneck line',
      roots: [],
      nodes: {
        S1: {
          id: 'S1',
          type: 'control',
          kind: 'splitter',
          displayName: 'Splitter',
          itemId: 'Desc_OreIron_C',
          inputs: [],
          outputs: [],
          expectedThroughput: 60,
          actualThroughput: 50,
          bottleneck: true,
        },
      },
      summary: {
        inputs: [],
        outputs: [],
        power: {
          expectedConsumption: 0,
          actualConsumption: 0,
          expectedGeneration: 0,
          actualGeneration: 0,
        },
        bottlenecks: [
          {
            nodeId: 'S1',
            itemId: 'Desc_OreIron_C',
            expectedRate: 60,
            actualRate: 50,
            reason: 'Splitter output belts limit flow',
          },
        ],
      },
      notes: [],
      buildingIds: [],
      transportNodeIds: ['S1'],
    };
    render(
      <LineGraph line={bottleneckLine} findings={[]} onSelectBuilding={() => undefined} />,
    );
    expect(screen.getByLabelText('Splitter (bottleneck)')).toBeInTheDocument();
  });

  it('stacks machines with the same recipe in one column', () => {
    const stackBuildings = [
      building('A', { displayName: 'Producer', outputs: rates({ Plate: 60 }) }),
      building('B', { displayName: 'Machine B', recipeId: 'Recipe_Stack', inputs: rates({ Plate: 20 }) }),
      building('C', { displayName: 'Machine C', recipeId: 'Recipe_Stack', inputs: rates({ Plate: 20 }) }),
      building('D', { displayName: 'Machine D', recipeId: 'Recipe_Stack', inputs: rates({ Plate: 20 }) }),
    ];
    const stackLine = line('line-stack', ['A', 'B', 'C', 'D'], {
      outputItems: ['Plate'],
      flows: [
        { from: 'A', to: 'B', itemId: 'Plate', rate: 20 },
        { from: 'A', to: 'C', itemId: 'Plate', rate: 20 },
        { from: 'A', to: 'D', itemId: 'Plate', rate: 20 },
      ],
    });
    const { container } = render(
      <LineGraph
        line={supply(stackBuildings, stackLine)}
        findings={[]}
        onSelectBuilding={() => undefined}
      />,
    );

    const position = (label: string) => {
      const node = screen.getByText(label).closest('.react-flow__node') as HTMLElement;
      const match = node.style.transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
      return match ? { x: Number(match[1]), y: Number(match[2]) } : undefined;
    };
    const b = position('Machine B');
    const c = position('Machine C');
    const d = position('Machine D');
    expect(b && c && d).toBeTruthy();
    expect(b!.x).toBeCloseTo(c!.x);
    expect(b!.x).toBeCloseTo(d!.x);
    expect(c!.y).toBeGreaterThan(b!.y);
    expect(d!.y).toBeGreaterThan(c!.y);
    expect(container.querySelectorAll('.react-flow__node').length).toBeGreaterThanOrEqual(4);
  });
});
