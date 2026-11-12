// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { parseSaveBuffer } from '../api/parseSave';

vi.mock('@etothepii/satisfactory-file-parser', () => ({
  Parser: { ParseSave: vi.fn() },
}));

const mockParse = vi.mocked(Parser.ParseSave);

const input = {
  fileName: 'empty.sav',
  buffer: new ArrayBuffer(4),
  sha256: 'x',
  size: 4,
};

describe('parseSaveBuffer edge cases', () => {
  beforeEach(() => {
    mockParse.mockReset();
  });

  it('rejects a save with no objects and clamps bad progress values', () => {
    mockParse.mockImplementation((_name, _buffer, options) => {
      options?.onProgressCallback?.(Number.NaN, 'bad progress');
      return {
        header: { saveVersion: 58, buildVersion: 1, isModdedSave: 0 },
        levels: {},
      } as never;
    });
    const progress: number[] = [];
    expect(() =>
      parseSaveBuffer(input, (entry) => progress.push(entry.progress)),
    ).toThrow('This save contains no objects to analyze.');
    expect(progress).toContain(0);
  });

  it('maps parser exceptions to a planner error', () => {
    mockParse.mockImplementation(() => {
      throw new Error('Offset is outside the bounds of the DataView');
    });
    expect(() => parseSaveBuffer(input)).toThrow(
      'This file is not a valid Satisfactory save. Its header could not be read.',
    );
  });
});
