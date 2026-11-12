// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseSaveBuffer } from '../api/parseSave';
import { analyzeModel } from '../domain/analyzeModel';

const fixtureUrl = new URL('../fixtures/Another-1-2.sav', import.meta.url);

describe('supply line analysis integration', () => {
  it('builds a supply model for the committed fixture', async () => {
    const buffer = await readFile(fixtureUrl);
    const model = parseSaveBuffer({
      fileName: 'Another-1-2.sav',
      buffer: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer,
      sha256: 'fixture',
      size: buffer.byteLength,
    });
    const analysis = analyzeModel(model);
    expect(analysis.supplyLines).toHaveLength(1);
    const line = analysis.supplyLines[0];
    expect(line.roots).toHaveLength(1);
    expect(line.nodes[line.roots[0]]).toMatchObject({ type: 'source' });
    expect(line.summary.outputs).toEqual([
      expect.objectContaining({
        itemId: 'Desc_SAM_C',
        expectedRate: 240,
        actualRate: 240,
      }),
    ]);
  });
});
