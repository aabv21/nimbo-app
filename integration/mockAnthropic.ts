// Mock Anthropic Messages API for the local functions. It listens on every interface since the Edge
// Runtime calls from a container (docs/local-stack.md#mocks).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

/** What the next `/v1/messages` calls get: a status and JSON body (after `delayMs`, if given), or no answer. */
export type MockReply = { status: number; body: unknown; delayMs?: number } | { hang: true };

/** A reply, or one computed from each call's parsed JSON body (null when it isn't JSON). */
export type AnthropicReply = MockReply | ((body: unknown) => MockReply);

export type MockAnthropic = {
  /** Sets the reply for every following call, until changed again. */
  respondWith(next: AnthropicReply): void;
  /** Answers the next calls with these replies in order (a tool round, then the answer), then `respondWith`'s again. */
  respondWithSequence(next: readonly AnthropicReply[]): void;
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
  let reply: AnthropicReply = DEFAULT_REPLY;
  let queue: AnthropicReply[] = [];
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
      const next = queue.shift() ?? reply;
      const current = typeof next === 'function' ? next(body) : next;
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

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function message(stopReason: 'end_turn' | 'tool_use', content: unknown[]): MockReply {
  return {
    status: 200,
    body: {
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      stop_reason: stopReason,
      content,
      usage: { input_tokens: 400, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/**
 * The `companion-checkin` scenario for the Maestro flow: whatever was typed, a `propose_checkin` round (5–6 hours of
 * sleep, high stress) on the day the request's second system block names, then, once its result is back, a short reply.
 */
export function companionCheckinReply(body: unknown): MockReply {
  const messages: unknown[] = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  const answered = messages.some(
    (turn) => isRecord(turn) && Array.isArray(turn.content) && (turn.content as unknown[]).some((block) => isRecord(block) && block.type === 'tool_result'),
  );
  if (answered) return message('end_turn', [{ type: 'text', text: 'A check-in draft is ready for you to check.' }]);
  const day = /Today is \w+, (\d{4}-\d{2}-\d{2})/.exec(isRecord(body) ? JSON.stringify(body.system) : '')?.[1];
  if (day === undefined) return { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: 'no day in the system blocks' } } };
  return message('tool_use', [
    { type: 'tool_use', id: 'toolu_mock_checkin', name: 'propose_checkin', input: { local_date: day, sleep_band: '5_6', stress: 'high' } },
  ]);
}

const SCENARIOS: ReadonlyMap<string, (body: unknown) => MockReply> = new Map([['companion-checkin', companionCheckinReply]]);

/** `node integration/mockAnthropic.ts --serve <scenario>`: keeps the mock answering one scenario for a manual check or a Maestro flow until Ctrl-C. */
async function serveFromCli(name: string | undefined): Promise<void> {
  const scenario = name === undefined ? undefined : SCENARIOS.get(name);
  if (scenario === undefined) throw new Error(`--serve needs a scenario: ${[...SCENARIOS.keys()].join(', ')}`);
  const mock = await startMockAnthropic();
  mock.respondWith(scenario);
  console.log(`mock Claude on :54519 (scenario ${String(name)})`);
  process.once('SIGINT', () => {
    void mock.close().then(() => {
      console.log(`served ${String(mock.calls())} Claude call(s)`);
    });
  });
}

const serveAt = process.argv.indexOf('--serve');
if (process.argv[1] === fileURLToPath(import.meta.url) && serveAt !== -1) {
  serveFromCli(process.argv[serveAt + 1]).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
