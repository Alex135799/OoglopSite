import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PlannerSummary } from '../components/PlannerSummary';
import { analyzeModel } from '../domain/analyzeModel';
import { building, line, model } from './helpers';

describe('PlannerSummary', () => {
  it('renders warnings, unmodeled types and a power deficit', () => {
    const summaryModel = model({
          source: { fileName: 'big.sav', sha256: 'e'.repeat(64), size: 2048 },
          warnings: ['Save is newer than the dataset.', 'Modded content detected.'],
          buildings: [building('A'), building('B')],
          lines: [line('line-1', ['A', 'B'], { outputItems: ['Desc_IronPlate_C'] })],
          coverage: {
            totalBuildings: 4,
            modeledBuildings: 2,
            ratio: 0.5,
            unmodeledTypes: Array.from({ length: 7 }, (_, index) => ({
              typeId: `Build_Mod${index}_C`,
              count: index + 1,
            })),
          },
          power: {
            generation: 10,
            consumption: 30,
            headroom: -20,
            headroomRatio: 0,
            generators: 1,
            consumers: 2,
            unmodeledGenerators: 0,
          },
        });
    render(<PlannerSummary model={summaryModel} analysis={analyzeModel(summaryModel)} />);

    expect(screen.getByText('Save is newer than the dataset.')).toBeInTheDocument();
    expect(screen.getByText('Modded content detected.')).toBeInTheDocument();
    expect(screen.getByText(/Unsupported types:/)).toBeInTheDocument();
    expect(screen.getByText('+1 more')).toBeInTheDocument();
    expect(screen.getByText('Deficit 20 MW')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('1 critical')).toBeInTheDocument();
  });

  it('hides the unsupported section when there are none', () => {
    const summaryModel = model({
          buildings: [building('A'), building('B')],
          lines: [line('line-1', ['A', 'B'], { outputItems: ['Desc_IronPlate_C'] })],
          coverage: {
            totalBuildings: 2,
            modeledBuildings: 2,
            ratio: 1,
            unmodeledTypes: [],
          },
        });
    render(<PlannerSummary model={summaryModel} analysis={analyzeModel(summaryModel)} />);
    expect(screen.queryByText(/Unsupported types:/)).not.toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });
});
