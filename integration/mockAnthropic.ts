// Mock Anthropic Messages API for the local functions. It listens on every interface since the Edge
// Runtime calls from a container (docs/local-stack.md#mocks).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/** What the next `/v1/messages` calls get: a status and JSON body (after `delayMs`, if given), or no answer. */
export type MockReply = { status: number; body: unknown; delayMs?: number } | { hang: true };

export type MockAnthropic = {
  /** Sets the reply for every following call, until changed again. */
  respondWith(next: MockReply): void;
  /** Answers the next calls with these replies in order (a tool round, then the answer), then `respondWith`'s again. */
  respondWithSequence(next: readonly MockReply[]): void;
  /** How many `POST /v1/messages` calls have arrived so far. */
  calls(): number;
  /** Every `POST /v1/messages` body so far, parsed (null when it wasn't JSON). */
  requests(): unknown[];
  /** The headers of each of those calls, lower-cased, in the same order (`anthropic-beta`, `anthropic-version`, …). */
  headers(): Record<string, string>[];
  close(): Promise<void>;
};

const DEFAULT_REPLY: MockReply = { status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no reply set' } } };

/** Sampling settings that API version 2026-10-21 refuses with a 400 on every model. */
const REFUSED_FIELDS = ['temperature', 'top_p', 'top_k'] as const;

function headersOf(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]])),
  );
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Until a test sets a reply, every call gets a 500, which the functions treat as Claude being down. */
export function startMockAnthropic(port = 54519): Promise<MockAnthropic> {
  let reply: MockReply = DEFAULT_REPLY;
  let queue: MockReply[] = [];
  let callCount = 0;
  const bodies: unknown[] = [];
  const headerLog: Record<string, string>[] = [];

  const server = createServer((request, response) => {
    // Read the whole body (a long chat) so the client never blocks on a full socket buffer.
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/messages') {
        sendJson(response, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } });
        return;
      }
      callCount += 1;
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        // Recorded as null; the reply below is still sent, as a test may want to see the call.
      }
      bodies.push(body);
      headerLog.push(headersOf(request));
      const refused = REFUSED_FIELDS.find((field) => typeof body === 'object' && body !== null && field in body);
      if (refused !== undefined) {
        // Checked before the queue, so a refused call never uses up a queued reply.
        sendJson(response, 400, { type: 'error', error: { type: 'invalid_request_error', message: `${refused}: not accepted on API version 2026-10-21` } });
        return;
      }
      const current = queue.shift() ?? reply;
      if ('hang' in current) return;
      if (current.delayMs === undefined) {
        sendJson(response, current.status, current.body);
        return;
      }
      setTimeout(() => {
        sendJson(response, current.status, current.body);
      }, current.delayMs);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve({
        respondWith(next) {
          reply = next;
        },
        respondWithSequence(next) {
          queue = [...next];
        },
        calls: () => callCount,
        requests: () => [...bodies],
        headers: () => headerLog.map((entry) => ({ ...entry })),
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            // Hung requests would otherwise keep `close()` waiting forever.
            server.closeAllConnections();
            server.close((error) => {
              if (error === undefined) resolveClose();
              else rejectClose(error);
            });
          }),
      });
    });
  });
}
