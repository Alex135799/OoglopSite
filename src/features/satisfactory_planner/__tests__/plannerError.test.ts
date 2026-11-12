import { describe, expect, it } from 'vitest';
import {
  PlannerException,
  parseErrorMessage,
  progressLabel,
  toPlannerError,
} from '../api/plannerError';

describe('plannerError', () => {
  it('maps planner exceptions and unknown errors', () => {
    expect(toPlannerError(new PlannerException('TOO_LARGE', 'Too big', 'detail'))).toEqual({
      code: 'TOO_LARGE',
      message: 'Too big',
      detail: 'detail',
    });
    expect(toPlannerError(new Error('boom'))).toEqual({
      code: 'PARSE_FAILED',
      message: 'Could not read this save file.',
      detail: 'boom',
    });
    expect(toPlannerError('nope')).toMatchObject({ detail: 'nope' });
    expect(toPlannerError(new PlannerException('ABORTED', 'Cancelled'))).toEqual({
      code: 'ABORTED',
      message: 'Cancelled',
    });
  });

  it('maps parser failures to actionable messages', () => {
    expect(parseErrorMessage(new Error('Offset is outside the bounds of the DataView'))).toMatchObject({
      message: 'This file is not a valid Satisfactory save. Its header could not be read.',
    });
    expect(parseErrorMessage(new Error('UnsupportedVersionError'))).toMatchObject({
      message: 'This save version is not supported. The planner is built for the bundled 1.2 game data.',
    });
    expect(parseErrorMessage(new Error('something else'))).toMatchObject({
      message: 'The save could not be parsed.',
      detail: 'something else',
    });
  });

  it('labels progress phases', () => {
    expect(progressLabel({ phase: 'reading', progress: 0 })).toBe('Reading file…');
    expect(progressLabel({ phase: 'parsing', progress: 0 })).toBe('Parsing save…');
    expect(progressLabel({ phase: 'parsing', progress: 0, message: 'Half way' })).toBe('Half way');
    expect(progressLabel({ phase: 'normalizing', progress: 0.9 })).toBe('Normalizing buildings…');
    expect(progressLabel({ phase: 'done', progress: 1 })).toBe('Ready');
    expect(progressLabel({ phase: 'unknown' as never, progress: 0 })).toBe('Working…');
  });
});
