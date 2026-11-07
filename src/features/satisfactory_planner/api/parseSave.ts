import { Parser } from '@etothepii/satisfactory-file-parser';
import type { NormalizedSave, ParseProgress } from '../domain/types';
import { buildLines } from '../domain/buildLines';
import { normalizeSave } from '../domain/normalizeSave';
import { gameData, itemName } from './gameData';
import { PlannerException, parseErrorMessage } from './plannerError';

export interface ParseSaveInput {
  fileName: string;
  buffer: ArrayBuffer;
  sha256: string;
  size: number;
  importedAt?: string;
}

const clampProgress = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
};

export const parseSaveBuffer = (
  input: ParseSaveInput,
  onProgress?: (progress: ParseProgress) => void,
): NormalizedSave => {
  if (input.buffer.byteLength === 0 || input.size === 0) {
    throw new PlannerException('EMPTY_FILE', 'This save file is empty.');
  }

  onProgress?.({ phase: 'parsing', progress: 0, message: 'Reading save header…' });

  let save;
  try {
    save = Parser.ParseSave(input.fileName, input.buffer, {
      throwErrors: false,
      onProgressCallback: (progress, message) =>
        onProgress?.({
          phase: 'parsing',
          progress: clampProgress(progress),
          ...(message ? { message } : {}),
        }),
    });
  } catch (error) {
    const mapped = parseErrorMessage(error);
    throw new PlannerException(mapped.code, mapped.message, mapped.detail);
  }

  const entityCount = Object.values(save.levels).reduce(
    (total, level) => total + level.objects.length,
    0,
  );
  if (entityCount === 0) {
    throw new PlannerException('EMPTY_SAVE', 'This save contains no objects to analyze.');
  }

  onProgress?.({ phase: 'normalizing', progress: 0.9, message: 'Normalizing buildings…' });

  const model = normalizeSave(save, {
    fileName: input.fileName,
    sha256: input.sha256,
    size: input.size,
    ...(input.importedAt ? { importedAt: input.importedAt } : {}),
  });

  model.lines = buildLines(model.buildings, {
    itemName: (itemId) => itemName(gameData, itemId),
  });
  model.findings = [];

  onProgress?.({ phase: 'done', progress: 1 });
  return model;
};
