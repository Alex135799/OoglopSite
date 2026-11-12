import type { NormalizedSave, ParseProgress, PlannerError } from '../domain/types';

export interface ParseWorkerRequest {
  type: 'parse';
  fileName: string;
  buffer: ArrayBuffer;
  sha256: string;
  size: number;
  importedAt?: string;
}

export type ParseWorkerResponse =
  | { type: 'progress'; progress: ParseProgress }
  | { type: 'result'; model: NormalizedSave }
  | { type: 'error'; error: PlannerError };
