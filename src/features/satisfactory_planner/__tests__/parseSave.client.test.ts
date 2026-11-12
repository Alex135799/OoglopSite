import { describe, expect, it, vi } from 'vitest';
import type { NormalizedSave, ParseProgress } from '../domain/types';
import {
  MAX_SAVE_BYTES,
  parseSaveFile,
  sha256Hex,
  validateSaveFile,
  type SaveFileLike,
} from '../api/parseSave.client';
import { PlannerException } from '../api/plannerError';
import { model } from './helpers';

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  posted: unknown[] = [];
  transfer: Transferable[] = [];
  readonly scriptURL = '';
  readonly onmessageerrorHandler = null;

  postMessage(message: unknown, transfer?: Transferable[]) {
    this.posted.push(message);
    this.transfer = transfer ?? [];
  }

  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent);
  }

  terminate() {
    this.terminated = true;
  }

  asWorker() {
    return this as unknown as Worker;
  }
}

const file = (name = 'factory.sav', size = 100): SaveFileLike => ({
  name,
  size,
  arrayBuffer: async () => new ArrayBuffer(size),
});

const hash = async () => 'a'.repeat(64);

describe('validateSaveFile', () => {
  it('rejects non-sav, empty and oversized files', () => {
    expect(() => validateSaveFile({ name: 'factory.txt', size: 10 })).toThrow(
      'Choose a Satisfactory .sav file.',
    );
    expect(() => validateSaveFile({ name: 'factory.sav', size: 0 })).toThrow(
      'This save file is empty.',
    );
    expect(() =>
      validateSaveFile({ name: 'factory.sav', size: MAX_SAVE_BYTES + 1 }),
    ).toThrow('The planner accepts saves up to 50 MB.');
  });

  it('accepts a normal save file', () => {
    expect(() => validateSaveFile({ name: 'FACTORY.SAV', size: 10 })).not.toThrow();
  });
});

describe('sha256Hex', () => {
  it('hashes bytes with SHA-256', async () => {
    const bytes = new TextEncoder().encode('abc');
    await expect(sha256Hex(bytes.buffer as ArrayBuffer)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('parseSaveFile', () => {
  it('hashes the file, posts it to the worker and resolves the model', async () => {
    const worker = new FakeWorker();
    const progress: ParseProgress[] = [];
    const expected = model();
    const promise = parseSaveFile(
      file(),
      { onProgress: (entry) => progress.push(entry) },
      {
        sha256: hash,
        workerFactory: () => {
          queueMicrotask(() => {
            worker.emit({ type: 'progress', progress: { phase: 'parsing', progress: 0.5 } });
            worker.emit({ type: 'result', model: expected });
          });
          return worker.asWorker();
        },
      },
    );

    await expect(promise).resolves.toBe(expected);
    expect(progress.map((entry) => entry.phase)).toEqual(['reading', 'reading', 'parsing']);
    expect(worker.posted[0]).toMatchObject({
      type: 'parse',
      fileName: 'factory.sav',
      sha256: 'a'.repeat(64),
      size: 100,
    });
    expect(worker.transfer).toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });

  it('rejects parser errors from the worker', async () => {
    const worker = new FakeWorker();
    const promise = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() =>
          worker.emit({
            type: 'error',
            error: { code: 'PARSE_FAILED', message: 'Bad save', detail: 'trace' },
          }),
        );
        return worker.asWorker();
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: 'PARSE_FAILED',
      message: 'Bad save',
      detail: 'trace',
    });
  });

  it('rejects invalid models and worker crashes', async () => {
    const invalidWorker = new FakeWorker();
    const invalid = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => invalidWorker.emit({ type: 'result', model: { nope: true } }));
        return invalidWorker.asWorker();
      },
    });
    await expect(invalid).rejects.toMatchObject({ code: 'WORKER_CRASH' });

    const crashWorker = new FakeWorker();
    const crash = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() =>
          crashWorker.onerror?.({ message: 'boom' } as ErrorEvent),
        );
        return crashWorker.asWorker();
      },
    });
    await expect(crash).rejects.toMatchObject({ code: 'WORKER_CRASH', detail: 'boom' });

    const messageErrorWorker = new FakeWorker();
    const messageError = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => messageErrorWorker.onmessageerror?.());
        return messageErrorWorker.asWorker();
      },
    });
    await expect(messageError).rejects.toMatchObject({ code: 'WORKER_CRASH' });
  });

  it('rejects when the import is aborted', async () => {
    const controller = new AbortController();
    const promise = parseSaveFile(
      file(),
      { signal: controller.signal },
      {
        sha256: async () => {
          controller.abort();
          return 'a'.repeat(64);
        },
      },
    );
    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('surfaces file read failures', async () => {
    const promise = parseSaveFile(
      { ...file(), arrayBuffer: async () => { throw new Error('read failed'); } },
      {},
      { sha256: hash },
    );
    await expect(promise).rejects.toThrow('read failed');
  });

  it('exposes a PlannerException type', () => {
    const error = new PlannerException('EMPTY_FILE', 'empty');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('EMPTY_FILE');
  });

  it('does not call a worker factory when the file is invalid', async () => {
    const factory = vi.fn();
    await expect(
      parseSaveFile({ ...file('factory.txt'), name: 'factory.txt' }, {}, { workerFactory: factory }),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    expect(factory).not.toHaveBeenCalled();
  });

  it('rejects when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      parseSaveFile(file(), { signal: controller.signal }, { sha256: hash }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('aborts while the worker is running', async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = parseSaveFile(file(), { signal: controller.signal }, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => controller.abort());
        return worker.asWorker();
      },
    });
    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
    expect(worker.terminated).toBe(true);
  });

  it('ignores messages after the first result settles the promise', async () => {
    const worker = new FakeWorker();
    const expected = model();
    const promise = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => {
          worker.emit({ type: 'result', model: expected });
          worker.emit({ type: 'result', model: expected });
          worker.emit({ type: 'progress', progress: { phase: 'done', progress: 1 } });
        });
        return worker.asWorker();
      },
    });
    await expect(promise).resolves.toBe(expected);
  });

  it('rejects a null model', async () => {
    const worker = new FakeWorker();
    const promise = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => worker.emit({ type: 'result', model: null }));
        return worker.asWorker();
      },
    });
    await expect(promise).rejects.toMatchObject({ code: 'WORKER_CRASH' });
  });

  it('wraps unexpected errors thrown by postMessage', async () => {
    const worker = new FakeWorker();
    worker.postMessage = () => {
      throw new Error('post failed');
    };
    await expect(
      parseSaveFile(file(), {}, { sha256: hash, workerFactory: () => worker.asWorker() }),
    ).rejects.toMatchObject({ code: 'WORKER_CRASH', message: 'Could not read this save file.' });
  });

  it('uses the default worker constructor', async () => {
    const controller = new AbortController();
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', class {
      constructor() {
        return worker;
      }
    });
    const promise = parseSaveFile(file(), { signal: controller.signal }, { sha256: hash });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'ABORTED' });
    vi.unstubAllGlobals();
  });

  it('reports when SHA-256 is unavailable', async () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', { randomUUID: () => 'id' });
    await expect(sha256Hex(new ArrayBuffer(1))).rejects.toMatchObject({ code: 'PARSE_FAILED' });
    vi.stubGlobal('crypto', original);
  });

  it('uses the default worker and hash implementation', async () => {
    const worker = new FakeWorker();
    vi.stubGlobal('Worker', class {
      constructor() {
        queueMicrotask(() => worker.emit({ type: 'result', model: model() }));
        return worker;
      }
    });
    await expect(parseSaveFile(file('default.sav'))).resolves.toMatchObject({ schemaVersion: 1 });
    vi.unstubAllGlobals();
  });

  it('ignores a second error after the first settles the promise', async () => {
    const worker = new FakeWorker();
    const promise = parseSaveFile(file(), {}, {
      sha256: hash,
      workerFactory: () => {
        queueMicrotask(() => {
          worker.emit({ type: 'error', error: { code: 'PARSE_FAILED', message: 'first' } });
          worker.emit({ type: 'error', error: { code: 'PARSE_FAILED', message: 'second' } });
        });
        return worker.asWorker();
      },
    });
    await expect(promise).rejects.toMatchObject({ message: 'first' });
  });
});
