// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { handleParseMessage } from '../api/parseSave.worker';
import type { ParseWorkerResponse } from '../api/parseSave.messages';

const fixtureUrl = new URL('../fixtures/Another-1-2.sav', import.meta.url);

describe('parse worker handler', () => {
  it('returns a normalized model for the committed fixture', async () => {
    const buffer = await readFile(fixtureUrl);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
    const messages: ParseWorkerResponse[] = [];

    handleParseMessage(
      {
        type: 'parse',
        fileName: 'Another-1-2.sav',
        buffer: arrayBuffer,
        sha256: 'fixture',
        size: buffer.byteLength,
      },
      (message) => messages.push(message),
    );

    const result = messages.find((message) => message.type === 'result');
    expect(result).toBeDefined();
    if (result?.type !== 'result') throw new Error('missing result');
    expect(result.model.buildings).toHaveLength(1);
    expect(result.model.lines).toHaveLength(1);
    expect(messages.some((message) => message.type === 'progress')).toBe(true);
  });

  it('returns a structured error for an empty buffer', () => {
    const messages: ParseWorkerResponse[] = [];
    handleParseMessage(
      {
        type: 'parse',
        fileName: 'empty.sav',
        buffer: new ArrayBuffer(0),
        sha256: 'empty',
        size: 0,
      },
      (message) => messages.push(message),
    );

    expect(messages).toEqual([
      {
        type: 'error',
        error: { code: 'EMPTY_FILE', message: 'This save file is empty.' },
      },
    ]);
  });

  it('ignores messages that are not parse requests', () => {
    const messages: ParseWorkerResponse[] = [];
    handleParseMessage({ type: 'other' } as never, (message) => messages.push(message));
    expect(messages).toEqual([]);
  });

  it('returns a parse error for a non-save buffer', () => {
    const messages: ParseWorkerResponse[] = [];
    handleParseMessage(
      {
        type: 'parse',
        fileName: 'bad.sav',
        buffer: new Uint8Array(5000).buffer,
        sha256: 'bad',
        size: 5000,
      },
      (message) => messages.push(message),
    );
    expect(messages[messages.length - 1]).toMatchObject({
      type: 'error',
      error: { code: 'PARSE_FAILED' },
    });
  });
});
