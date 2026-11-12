import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PlannerPage, type PlannerPageProps } from '../PlannerPage';
import { PlannerException } from '../api/plannerError';
import type { NormalizedSave } from '../domain/types';
import type { CheckpointRepository } from '../storage/db';
import { building, line, model, rates } from './helpers';

const testModel = (): NormalizedSave =>
  model({
    source: { fileName: 'factory.sav', sha256: 'c'.repeat(64), size: 2048 },
    counts: {
      entities: 10,
      buildables: 5,
      productionBuildings: 2,
      belts: 3,
      pipes: 0,
    },
    buildings: [
      building('A', {
        typeId: 'Build_MinerMk1_C',
        displayName: 'Constructor',
        outputs: rates({ Desc_IronPlate_C: 60 }),
        powerConsumption: 0,
      }),
      building('B', {
        displayName: 'Assembler',
        recipeName: 'Iron Plate',
        recipeId: 'Recipe_IronPlate_C',
        inputs: rates({ Desc_IronPlate_C: 90 }),
        outputs: rates({ Desc_IronPlate_C: 30 }),
        powerConsumption: 15,
      }),
    ],
    lines: [
      line('line-1', ['A', 'B'], {
        name: 'Iron Plate line',
        outputItems: ['Desc_IronPlate_C'],
        flows: [
          {
            from: 'A',
            to: 'B',
            itemId: 'Desc_IronPlate_C',
            rate: 60,
          },
        ],
        balance: [{ itemId: 'Desc_IronPlate_C', supply: 60, demand: 90 }],
      }),
    ],
    power: {
      generation: 0,
      consumption: 19,
      headroom: -19,
      headroomRatio: 0,
      generators: 0,
      consumers: 2,
      unmodeledGenerators: 0,
    },
    coverage: {
      totalBuildings: 2,
      modeledBuildings: 2,
      ratio: 1,
      unmodeledTypes: [],
    },
  });

const createRepository = (
  overrides: Partial<CheckpointRepository> = {},
): CheckpointRepository =>
  ({
    saveSession: vi.fn(async () => undefined),
    loadSession: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    saveCheckpoint: vi.fn(),
    listCheckpoints: vi.fn(async () => []),
    getCheckpoint: vi.fn(),
    deleteCheckpoint: vi.fn(async () => undefined),
    deleteAll: vi.fn(async () => undefined),
    getUsage: vi.fn(async () => ({
      checkpoints: 0,
      saves: 0,
      bytes: 0,
      percent: 0,
      warning: false,
    })),
    exportCheckpoint: vi.fn(),
    importCheckpoint: vi.fn(),
    close: vi.fn(async () => undefined),
    ...overrides,
  }) as unknown as CheckpointRepository;

const renderPage = (
  parseSave: NonNullable<PlannerPageProps['parseSave']>,
  repository = createRepository(),
) =>
  render(
    <MemoryRouter>
      <PlannerPage parseSave={parseSave} repository={repository} />
    </MemoryRouter>,
  );

const upload = async () => {
  const input = screen.getByLabelText('Choose save');
  await userEvent.upload(input, new File([new Uint8Array(10)], 'factory.sav'));
};

describe('PlannerPage', () => {

  it('shows the upload experience and privacy note before a save is loaded', () => {
    renderPage(async () => testModel());
    expect(
      screen.getByRole('heading', { name: 'Import a Satisfactory save' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/never uploaded/)).toBeInTheDocument();
    expect(screen.getByAltText('Satisfactory banner')).toBeInTheDocument();
  });

  it('imports a save and renders the summary', async () => {
    renderPage(async () => testModel());
    await upload();

    expect(await screen.findByRole('heading', { name: 'factory.sav' })).toBeInTheDocument();
    expect(screen.getAllByText('2 / 2')).toHaveLength(2);
    expect(screen.getByText('Game data 1.2')).toBeInTheDocument();
    expect(screen.getByText('1 critical')).toBeInTheDocument();
    expect(screen.getByText('2 warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import another save' })).toBeInTheDocument();
  });

  it('shows findings and building details', async () => {
    renderPage(async () => testModel());
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });

    const findingsTab = screen.getByText(/^Findings/);
    await userEvent.click(findingsTab);

    expect(
      screen.getByText(/Iron Plate production shortfall in/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'B' })[0]);
    expect(screen.getByText('Recipe')).toBeInTheDocument();
    expect(screen.getAllByText('Iron Plate').length).toBeGreaterThan(0);
    expect(screen.getByText(/90 expected/)).toBeInTheDocument();
  });

  it('shows an actionable parse error', async () => {
    renderPage(async () => {
      throw new PlannerException('PARSE_FAILED', 'This file is not a valid save.', 'trace');
    });
    await upload();

    expect(await screen.findByText('This file is not a valid save.')).toBeInTheDocument();
    expect(screen.getByText('Technical details')).toBeInTheDocument();
    expect(screen.getByText('trace')).toBeInTheDocument();
  });

  it('clears the error when dismissed', async () => {
    renderPage(async () => {
      throw new PlannerException('PARSE_FAILED', 'Broken save');
    });
    await upload();
    await screen.findByText('Broken save');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Broken save')).not.toBeInTheDocument();
  });

  it('does not show an error for a cancelled import', async () => {
    renderPage(async () => {
      throw new PlannerException('ABORTED', 'Import cancelled.');
    });
    await upload();
    await waitFor(() => expect(screen.queryByText('Import cancelled.')).not.toBeInTheDocument());
  });

  it('switches back to the upload screen after an error', async () => {
    const parseSave = vi
      .fn()
      .mockRejectedValueOnce(new PlannerException('INVALID_FILE', 'Choose a .sav file.'))
      .mockResolvedValueOnce(testModel());
    renderPage(parseSave);
    await upload();
    expect(await screen.findByText('Choose a .sav file.')).toBeInTheDocument();
    await upload();
    expect(await screen.findByRole('heading', { name: 'factory.sav' })).toBeInTheDocument();
  });

  it('opens the lines tab and renders the graph', async () => {
    renderPage(async () => testModel());
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });
    await userEvent.click(screen.getByText(/^Lines/));
    expect(screen.getByRole('heading', { name: 'Supply lines' })).toBeInTheDocument();
    expect(await screen.findByText('Constructor')).toBeInTheDocument();
    expect(screen.getByText('Iron Plate line')).toBeInTheDocument();
  });

  it('opens the checkpoints tab with a repository', async () => {
    const repository = createRepository();
    renderPage(async () => testModel(), repository);
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });
    await userEvent.click(screen.getByText('Checkpoints'));
    expect(await screen.findByRole('heading', { name: 'Checkpoints' })).toBeInTheDocument();
    expect(await screen.findByText('No checkpoints yet.')).toBeInTheDocument();
  });

  it('jumps from the overview to all findings', async () => {
    renderPage(async () => testModel());
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });
    await userEvent.click(screen.getByRole('button', { name: 'View all 3' }));
    expect(screen.getByRole('heading', { name: 'Estimated findings' })).toBeInTheDocument();
  });

  it('cancels a running import', async () => {
    const parseSave = ((_file: unknown, options?: { signal?: AbortSignal }) =>
      new Promise<NormalizedSave>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject(new PlannerException('ABORTED', 'Import cancelled.')),
        );
      })) as unknown as typeof import('../api/parseSave.client').parseSaveFile;
    renderPage(parseSave);
    await upload();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await userEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument());
  });


  it('restores the current session on mount', async () => {
    const saved = testModel();
    const repository = createRepository({ loadSession: async () => saved });
    renderPage(async () => testModel(), repository);

    expect(await screen.findByRole('heading', { name: 'factory.sav' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Import a Satisfactory save' })).not.toBeInTheDocument();
  });

  it('persists the current model after a successful import', async () => {
    const repository = createRepository();
    renderPage(async () => testModel(), repository);
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });

    expect(repository.saveSession).toHaveBeenCalledWith(
      expect.objectContaining({ source: expect.objectContaining({ fileName: 'factory.sav' }) }),
    );
  });

  it('unloads the current save and clears the saved session', async () => {
    const repository = createRepository();
    renderPage(async () => testModel(), repository);
    await upload();
    await screen.findByRole('heading', { name: 'factory.sav' });

    await userEvent.click(screen.getByRole('button', { name: 'Unload current save' }));
    expect(
      await screen.findByRole('heading', { name: 'Import a Satisfactory save' }),
    ).toBeInTheDocument();
    expect(repository.clearSession).toHaveBeenCalledTimes(1);
  });
});
