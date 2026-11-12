/// <reference lib="webworker" />
import { parseSaveBuffer } from './parseSave';
import type { ParseWorkerRequest, ParseWorkerResponse } from './parseSave.messages';
import { toPlannerError } from './plannerError';

export const handleParseMessage = (
  request: ParseWorkerRequest,
  post: (message: ParseWorkerResponse) => void,
): void => {
  if (request?.type !== 'parse') return;
  try {
    const model = parseSaveBuffer(request, (progress) =>
      post({ type: 'progress', progress }),
    );
    post({ type: 'result', model });
  } catch (error) {
    post({ type: 'error', error: toPlannerError(error) });
  }
};

const workerScope =
  typeof self !== 'undefined' && typeof self.postMessage === 'function'
    ? (self as unknown as DedicatedWorkerGlobalScope)
    : undefined;

if (workerScope) {
  workerScope.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
    handleParseMessage(event.data, (message) => workerScope.postMessage(message));
  };
}
