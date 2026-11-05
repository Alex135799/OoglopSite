import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteDB } from 'idb';
import { createCheckpointRepository } from '../storage/db';
import { building, model } from './helpers';
import type { CheckpointRepository } from '../storage/db';

let counter = 0;
const repos: { repo: CheckpointRepository; name: string }[] = [];

const makeRepo = () => {
  const name = `ooglop-test-${counter += 1}`;
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
    source: { fileName: 'factory.sav', sha256: 'b'.repeat(64), size: 10 },
    buildings: [building('A')],
  });

describe('checkpoint repository', () => {
  it('saves, lists, gets and exports checkpoints', async () => {
    const repo = makeRepo();
    const blob = new Blob([new Uint8Array(10)]);
    const saved = await repo.saveCheckpoint({
      model: testModel(),
      label: '  My factory  ',
      file: blob,
    });

    expect(saved.label).toBe('My factory');
    expect(saved.saveHash).toBe('b'.repeat(64));
    expect(await repo.listCheckpoints()).toHaveLength(1);

    const fetched = await repo.getCheckpoint(saved.id);
    expect(fetched?.model.buildings[0].id).toBe('A');

    const exported = JSON.parse(await repo.exportCheckpoint(saved.id));
    expect(exported).toMatchObject({
      format: 'ooglop-planner-checkpoint',
      version: 1,
      label: 'My factory',
    });
    expect(exported.model.buildings).toHaveLength(1);
  });

  it('uses a generated label when the label is empty', async () => {
    const repo = makeRepo();
    const saved = await repo.saveCheckpoint({ model: testModel(), label: '   ' });
    expect(saved.label).toContain('Checkpoint');
  });

  it('deduplicates save blobs by hash and cleans them up with the last checkpoint', async () => {
    const repo = makeRepo();
    const first = await repo.saveCheckpoint({
      model: testModel(),
      label: 'One',
      file: new Blob([new Uint8Array(10)]),
    });
    const second = await repo.saveCheckpoint({
      model: testModel(),
      label: 'Two',
      file: new Blob([new Uint8Array(10)]),
    });

    expect((await repo.getUsage()).saves).toBe(1);
    expect((await repo.getUsage()).bytes).toBe(10);

    await repo.deleteCheckpoint(first.id);
    expect((await repo.getUsage()).saves).toBe(1);
    await repo.deleteCheckpoint(second.id);
    expect((await repo.getUsage()).saves).toBe(0);
    expect(await repo.listCheckpoints()).toEqual([]);
  });

  it('imports exported checkpoints and rejects invalid files', async () => {
    const repo = makeRepo();
    const saved = await repo.saveCheckpoint({ model: testModel(), label: 'Original' });
    const exported = await repo.exportCheckpoint(saved.id);

    const imported = await repo.importCheckpoint(exported);
    expect(imported.label).toBe('Original');
    expect(imported.model.buildings).toHaveLength(1);
    expect(await repo.listCheckpoints()).toHaveLength(2);

    const raw = JSON.stringify(testModel());
    const importedRaw = await repo.importCheckpoint(raw);
    expect(importedRaw.label).toContain('Imported factory.sav');

    await expect(repo.importCheckpoint('not json')).rejects.toThrow('not valid JSON');
    await expect(repo.importCheckpoint(JSON.stringify({ hello: 'world' }))).rejects.toThrow(
      'does not contain a planner model',
    );
    await expect(repo.importCheckpoint('null')).rejects.toThrow(
      'does not contain a planner model',
    );
    await expect(repo.exportCheckpoint('missing')).rejects.toThrow('Checkpoint not found');
  });

  it('reports storage usage and warns at more than twenty checkpoints', async () => {
    const repo = makeRepo();
    for (let index = 0; index < 21; index += 1) {
      await repo.saveCheckpoint({ model: testModel(), label: `Checkpoint ${index}` });
    }
    const usage = await repo.getUsage();
    expect(usage.checkpoints).toBe(21);
    expect(usage.warning).toBe(true);
    expect(usage.percent).toBe(0);
  });

  it('deletes all checkpoints and saves', async () => {
    const repo = makeRepo();
    await repo.saveCheckpoint({
      model: testModel(),
      label: 'One',
      file: new Blob([new Uint8Array(10)]),
    });
    await repo.deleteAll();
    expect(await repo.listCheckpoints()).toEqual([]);
    const usage = await repo.getUsage();
    expect(usage.checkpoints).toBe(0);
    expect(usage.saves).toBe(0);
  });

  it('handles deleting a missing checkpoint', async () => {
    const repo = makeRepo();
    await expect(repo.deleteCheckpoint('missing')).resolves.toBeUndefined();
  });

  it('reports quota estimates and catches estimate failures', async () => {
    const repo = makeRepo();
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ quota: 1000, usage: 850 }) },
    });
    const usage = await repo.getUsage();
    expect(usage.quota).toBe(1000);
    expect(usage.usage).toBe(850);
    expect(usage.percent).toBeCloseTo(0.85);
    expect(usage.warning).toBe(true);

    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ quota: 1000 }) } });
    const noUsage = await repo.getUsage();
    expect(noUsage.percent).toBe(0);
    expect(noUsage.usage).toBeUndefined();

    vi.stubGlobal('navigator', {
      storage: {
        estimate: async () => {
          throw new Error('denied');
        },
      },
    });
    const failed = await repo.getUsage();
    expect(failed.quota).toBeUndefined();
    expect(failed.percent).toBe(0);
    vi.unstubAllGlobals();
  });

  it('falls back to a timestamp id when randomUUID is unavailable', async () => {
    const repo = makeRepo();
    vi.stubGlobal('crypto', {});
    const saved = await repo.saveCheckpoint({ model: testModel(), label: 'Fallback' });
    expect(saved.id).toMatch(/^checkpoint-/);
    vi.unstubAllGlobals();
  });

  it('stores and restores the current session', async () => {
    const repo = makeRepo();
    expect(await repo.loadSession()).toBeUndefined();

    const current = testModel();
    await repo.saveSession(current);
    expect(await repo.loadSession()).toEqual(current);

    await repo.clearSession();
    expect(await repo.loadSession()).toBeUndefined();
  });
});
