import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { CheckpointList } from '../components/CheckpointList';
import { createCheckpointRepository, type CheckpointRepository } from '../storage/db';
import { building, model } from './helpers';

let counter = 0;
const repos: { repo: CheckpointRepository; name: string }[] = [];

const makeRepo = () => {
  const name = `ooglop-ui-test-${counter += 1}`;
  const repo = createCheckpointRepository(name);
  repos.push({ repo, name });
  return repo;
};

afterEach(async () => {
  for (const { repo, name } of repos.splice(0)) {
    await repo.close();
    await deleteDB(name);
  }
});

const testModel = () =>
  model({
    source: { fileName: 'factory.sav', sha256: 'd'.repeat(64), size: 100 },
    buildings: [building('A')],
  });

const renderList = (repo: CheckpointRepository, onRestore = vi.fn()) =>
  render(
    <CheckpointList
      currentModel={testModel()}
      currentFile={new File([new Uint8Array(10)], 'factory.sav')}
      onRestore={onRestore}
      repository={repo}
    />,
  );

describe('CheckpointList', () => {
  it('saves, lists and opens checkpoints', async () => {
    const repo = makeRepo();
    const onRestore = vi.fn();
    renderList(repo, onRestore);
    expect(await screen.findByText('No checkpoints yet.')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Checkpoint label'), 'First factory');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));

    expect(await screen.findByText('Checkpoint saved.')).toBeInTheDocument();
    expect(screen.getByText('First factory')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore.mock.calls[0][0].source.fileName).toBe('factory.sav');
  });

  it('uses a generated label when the label is blank', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect(await screen.findByRole('cell', { name: /^Checkpoint / })).toBeInTheDocument();
  });

  it('compares two checkpoints and renders the diff', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');

    await userEvent.type(screen.getByLabelText('Checkpoint label'), 'First');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    await screen.findByText('First');

    await userEvent.type(screen.getByLabelText('Checkpoint label'), 'Second');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    expect((await screen.findAllByText('Second')).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByLabelText('Before (A)'));
    await userEvent.click(await screen.findByRole('option', { name: 'First' }));
    await userEvent.click(screen.getByLabelText('After (B)'));
    await userEvent.click(await screen.findByRole('option', { name: 'Second' }));
    await userEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(await screen.findByRole('heading', { name: 'First → Second' })).toBeInTheDocument();
    expect(screen.getByText('No building changes.')).toBeInTheDocument();
  });

  it('imports and deletes checkpoints', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');

    const json = JSON.stringify(testModel());
    await userEvent.upload(
      screen.getByLabelText('Import checkpoint JSON'),
      new File([json], 'checkpoint.json', { type: 'application/json' }),
    );
    expect(await screen.findByText('Checkpoint imported.')).toBeInTheDocument();
    expect(screen.getByText('Imported factory.sav')).toBeInTheDocument();

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    await waitFor(() => expect(screen.getByText('No checkpoints yet.')).toBeInTheDocument());
  });

  it('deletes a single checkpoint', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');
    await userEvent.type(screen.getByLabelText('Checkpoint label'), 'Only');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    await screen.findByText('Only');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Checkpoint deleted.')).toBeInTheDocument();
    expect(screen.getByText('No checkpoints yet.')).toBeInTheDocument();
  });

  it('reports repository failures', async () => {
    const repo = makeRepo();
    const failing = {
      ...repo,
      listCheckpoints: async () => {
        throw new Error('IndexedDB unavailable');
      },
    } as CheckpointRepository;
    renderList(failing);
    expect(await screen.findByText('IndexedDB unavailable')).toBeInTheDocument();
  });

  it('exports checkpoints as JSON downloads', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');
    await userEvent.type(screen.getByLabelText('Checkpoint label'), 'Export me');
    await userEvent.click(screen.getByRole('button', { name: 'Save checkpoint' }));
    await screen.findByText('Export me');

    const createObjectURL = vi.fn(() => 'blob:checkpoint');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });

  it('reports an invalid imported checkpoint', async () => {
    const repo = makeRepo();
    renderList(repo);
    await screen.findByText('No checkpoints yet.');
    await userEvent.upload(
      screen.getByLabelText('Import checkpoint JSON'),
      new File(['not json'], 'checkpoint.json', { type: 'application/json' }),
    );
    expect(await screen.findByText('The checkpoint file is not valid JSON.')).toBeInTheDocument();
  });
});
