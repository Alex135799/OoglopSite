import type { NormalizedSave, ParseProgress } from '../domain/types';
import { PlannerException, toPlannerError } from './plannerError';
import type { ParseWorkerRequest, ParseWorkerResponse } from './parseSave.messages';

export const MAX_SAVE_BYTES = 50 * 1024 * 1024;

export interface SaveFileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ParseSaveClientOptions {
  onProgress?: (progress: ParseProgress) => void;
  signal?: AbortSignal;
}

export interface ParseSaveDependencies {
  sha256?: (buffer: ArrayBuffer) => Promise<string>;
  workerFactory?: () => Worker;
}

export const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new PlannerException(
      'PARSE_FAILED',
      'This browser does not expose SHA-256 hashing, which the planner needs for checkpoint identity.',
    );
  }
  const digest = await subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export const validateSaveFile = (file: Pick<SaveFileLike, 'name' | 'size'>): void => {
  if (!/\.sav$/i.test(file.name)) {
    throw new PlannerException('INVALID_FILE', 'Choose a Satisfactory .sav file.');
  }
  if (file.size === 0) {
    throw new PlannerException('EMPTY_FILE', 'This save file is empty.');
  }
  if (file.size > MAX_SAVE_BYTES) {
    const size = (file.size / (1024 * 1024)).toFixed(1);
    throw new PlannerException(
      'TOO_LARGE',
      `This save is ${size} MB. The planner accepts saves up to ${MAX_SAVE_BYTES / (1024 * 1024)} MB.`,
    );
  }
};

const createWorker = (): Worker =>
  new Worker(new URL('./parseSave.worker.ts', import.meta.url), { type: 'module' });

const isNormalizedSave = (value: unknown): value is NormalizedSave => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<NormalizedSave>;
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.buildings) &&
    Array.isArray(candidate.lines) &&
    Array.isArray(candidate.findings) &&
    typeof candidate.gameDataVersion === 'string'
  );
};

export const parseSaveFile = async (
  file: SaveFileLike,
  options: ParseSaveClientOptions = {},
  dependencies: ParseSaveDependencies = {},
): Promise<NormalizedSave> => {
  validateSaveFile(file);
  options.onProgress?.({ phase: 'reading', progress: 0 });

  const buffer = await file.arrayBuffer();
  if (options.signal?.aborted) {
    throw new PlannerException('ABORTED', 'Import cancelled.');
  }

  const hash = await (dependencies.sha256 ?? sha256Hex)(buffer);
  if (options.signal?.aborted) {
    throw new PlannerException('ABORTED', 'Import cancelled.');
  }
  options.onProgress?.({ phase: 'reading', progress: 0.15, message: 'File hashed' });

  const worker = (dependencies.workerFactory ?? createWorker)();
  const request: ParseWorkerRequest = {
    type: 'parse',
    fileName: file.name,
    buffer,
    sha256: hash,
    size: file.size,
  };

  return new Promise<NormalizedSave>((resolve, reject) => {
    let settled = false;

    const fail = (error: PlannerException) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      options.signal?.removeEventListener('abort', abort);
      reject(error);
    };

    const abort = () => fail(new PlannerException('ABORTED', 'Import cancelled.'));

    if (options.signal) {
      options.signal.addEventListener('abort', abort, { once: true });
    }

    worker.onerror = (event) => {
      fail(
        new PlannerException(
          'WORKER_CRASH',
          'The save parser stopped unexpectedly. Try reloading the page.',
          event.message,
        ),
      );
    };
    worker.onmessageerror = () => {
      fail(new PlannerException('WORKER_CRASH', 'The save parser returned unreadable data.'));
    };
    worker.onmessage = (event: MessageEvent<ParseWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        options.onProgress?.(message.progress);
        return;
      }
      if (message.type === 'error') {
        fail(new PlannerException(message.error.code, message.error.message, message.error.detail));
        return;
      }
      if (message.type === 'result') {
        if (!isNormalizedSave(message.model)) {
          fail(new PlannerException('WORKER_CRASH', 'The save parser returned an invalid model.'));
          return;
        }
        if (settled) return;
        settled = true;
        worker.terminate();
        options.signal?.removeEventListener('abort', abort);
        resolve(message.model);
      }
    };

    worker.postMessage(request, [buffer]);
  }).catch((error: unknown) => {
    throw error instanceof PlannerException ? error : new PlannerException('WORKER_CRASH', toPlannerError(error).message);
  });
};
