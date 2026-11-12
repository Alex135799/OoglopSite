import type { ParseProgress, PlannerError, PlannerErrorCode } from '../domain/types';

export class PlannerException extends Error {
  readonly code: PlannerErrorCode;
  readonly detail?: string;

  constructor(code: PlannerErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'PlannerException';
    this.code = code;
    this.detail = detail;
  }
}

export const toPlannerError = (error: unknown): PlannerError => {
  if (error instanceof PlannerException) {
    return {
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: 'PARSE_FAILED',
    message: 'Could not read this save file.',
    detail: message,
  };
};

export const parseErrorMessage = (error: unknown): PlannerError => {
  const message = error instanceof Error ? error.message : String(error);
  if (/offset is outside|dataview|buffer|end of data|unexpected end/i.test(message)) {
    return {
      code: 'PARSE_FAILED',
      message: 'This file is not a valid Satisfactory save. Its header could not be read.',
      detail: message,
    };
  }
  if (/unsupportedversion|save version|too old/i.test(message)) {
    return {
      code: 'PARSE_FAILED',
      message:
        'This save version is not supported. The planner is built for the bundled 1.2 game data.',
      detail: message,
    };
  }
  return {
    code: 'PARSE_FAILED',
    message: 'The save could not be parsed.',
    detail: message,
  };
};

export const progressLabel = (progress: ParseProgress): string => {
  switch (progress.phase) {
    case 'reading':
      return 'Reading file…';
    case 'parsing':
      return progress.message ?? 'Parsing save…';
    case 'normalizing':
      return 'Normalizing buildings…';
    case 'done':
      return 'Ready';
    default:
      return 'Working…';
  }
};
