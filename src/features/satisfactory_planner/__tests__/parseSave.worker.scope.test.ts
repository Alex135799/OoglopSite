import { describe, expect, it } from 'vitest';

describe('parse worker scope registration', () => {
  it('registers a message handler when self can post messages', async () => {
    await import('../api/parseSave.worker');
    expect(typeof self.onmessage).toBe('function');
    self.onmessage?.({ data: { type: 'other' } } as MessageEvent);
  });
});
