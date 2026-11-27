// Mock TypeSafe System One (Jev) for the local functions. It listens on every interface since the Edge
// Runtime calls from a container (docs/local-stack.md#mocks).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import type { MockReply } from './mockAnthropic';

export type { MockReply };

/** A Jev reply, or one computed from each request's parsed JSON body (`undefined` if it isn't JSON). */
export type JevReply = MockReply | ((body: unknown) => MockReply);

export type MockServices = {
  /** Sets the reply for every following `POST /v1/systemone`, until changed again. */
  respondJev(next: JevReply): void;
  /** Every `POST /v1/systemone` body so far, parsed (`undefined` when it wasn't JSON), oldest first. */
  jevRequests(): unknown[];
  /** The headers of each of those calls, lower-cased, in the same order. */
  jevHeaders(): Record<string, string>[];
  close(): Promise<void>;
};

const JEV_PATH = '/v1/systemone';

/** The Noul every question gets unless overridden: a clear no. */
const DEFAULT_NOUL = 0.02;
/** The probability the chosen option of a Choice (or level of a Score) gets; the rest share what is left. */
const TOP_PROBABILITY = 0.9;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `chosen` (one of `options`) at `TOP_PROBABILITY` and the other options sharing the rest, summing to 1. */
function distribution(options: readonly string[], chosen: string): Record<string, number> {
  const rest = options.length === 1 ? 0 : (1 - TOP_PROBABILITY) / (options.length - 1);
  return Object.fromEntries(options.map((option) => [option, option === chosen ? (options.length === 1 ? 1 : TOP_PROBABILITY) : rest]));
}

function answerOf(id: string, question: unknown, override: number | string | undefined): unknown {
  const wrong = (expected: string): Error => new Error(`jevAnswersWith: ${id} is a ${String(isRecord(question) ? question.type : 'question')}, so its override must be ${expected}`);
  if (!isRecord(question)) throw new Error(`jevAnswersWith: ${id} is not a question`);
  if (question.type === 'noul') {
    if (override !== undefined && (typeof override !== 'number' || override < 0 || override > 1)) throw wrong('a number from 0 to 1');
    return { type: 'noul', noul: override ?? DEFAULT_NOUL };
  }
  if (question.type === 'choice') {
    if (override !== undefined && typeof override !== 'string') throw wrong('an option name');
    const options = isRecord(question.criteria) ? Object.keys(question.criteria) : [];
    const choice = override ?? (options.includes('other') ? 'other' : options[0]);
    if (choice === undefined || !options.includes(choice)) {
      throw new Error(`jevAnswersWith: ${id} has no option ${String(choice)} (options: ${options.join(', ')})`);
    }
    const probabilities = distribution(options, choice);
    return { type: 'choice', choice, confidence: Math.max(...Object.values(probabilities)), probabilities };
  }
  if (question.type === 'score') {
    const levels: unknown[] = Array.isArray(question.criteria) ? question.criteria : [];
    if (override !== undefined && (typeof override !== 'number' || !Number.isInteger(override) || override < 0 || override >= levels.length)) {
      throw wrong('a level index');
    }
    if (levels.length === 0) throw new Error(`jevAnswersWith: ${id} has no levels`);
    const level = override ?? 0;
    const probabilities = distribution(levels.map((_, index) => String(index)), String(level));
    const legend = Object.fromEntries(levels.map((text, index) => [String(index), text]));
    // System One's score is the expected level, so it is fractional like the real one.
    const score = Object.entries(probabilities).reduce((sum, [index, p]) => sum + Number(index) * p, 0);
    return { type: 'score', score, confidence: Math.max(...Object.values(probabilities)), legend, probabilities };
  }
  throw new Error(`jevAnswersWith: ${id} has an unknown type`);
}

/**
 * A System One response, in the documented shape, answering every question in `request`: each Noul
 * 0.02, each Choice `other` (else its first option) and each Score near its first level, unless
 * `overrides` names the question (a Score by level index). Throws on an override for no question,
 * of the wrong kind or naming no option, so a test cannot pass by a typo.
 */
export function jevAnswersWith(request: unknown, overrides: Readonly<Record<string, number | string>>): unknown {
  const questions: Record<string, unknown> = isRecord(request) && isRecord(request.questions) ? request.questions : {};
  const overridden = new Map(Object.entries(overrides));
  for (const id of overridden.keys()) {
    if (!(id in questions)) throw new Error(`jevAnswersWith: ${id} is not a question in the request`);
  }
  const answers = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, answerOf(id, question, overridden.get(id))]));
  // Roughly four characters a token; only the shape matters to the functions.
  return { model: 'jev-mock', answers, usage: { input_tokens: Math.ceil(JSON.stringify(request ?? null).length / 4), output_tokens: 0 } };
}

const DEFAULT_JEV: JevReply = (body) => ({ status: 200, body: jevAnswersWith(body, {}) });

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

function headersOf(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(request.headers).flatMap(([name, value]) => (value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]])),
  );
}

/** System One's 422 for each required field the body lacks, or null when none is missing. */
function missingFields(body: unknown): unknown {
  const missing = (['model', 'state', 'questions'] as const).filter((field) => !isRecord(body) || !Object.hasOwn(body, field));
  if (missing.length === 0) return null;
  return { detail: missing.map((field) => ({ loc: ['body', field], msg: 'Field required', type: 'missing' })) };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Starts the mock on `port`. Until a test sets its own reply, Jev answers `jevAnswersWith(body, {})`: nothing flagged. */
export function startMockServices(port = 54518): Promise<MockServices> {
  let jevReply: JevReply = DEFAULT_JEV;
  const requests: unknown[] = [];
  const headers: Record<string, string>[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const path = new URL(request.url ?? '/', 'http://mock').pathname;
      if (request.method !== 'POST' || path !== JEV_PATH) {
        sendJson(response, 404, { detail: 'Not Found' });
        return;
      }
      const body = parseJson(Buffer.concat(chunks).toString('utf8'));
      requests.push(body);
      headers.push(headersOf(request));
      const invalid = missingFields(body);
      if (invalid !== null) {
        sendJson(response, 422, invalid);
        return;
      }
      let reply: MockReply;
      try {
        reply = typeof jevReply === 'function' ? jevReply(body) : jevReply;
      } catch (error) {
        // A reply function that throws (a bad override) answers 500, so the function under test degrades.
        reply = { status: 500, body: { detail: error instanceof Error ? error.message : 'mock reply failed' } };
      }
      if ('hang' in reply) return;
      const { status, body: replyBody, delayMs } = reply;
      if (delayMs === undefined) {
        sendJson(response, status, replyBody);
        return;
      }
      setTimeout(() => {
        sendJson(response, status, replyBody);
      }, delayMs);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject);
      resolve({
        respondJev(next) {
          jevReply = next;
        },
        jevRequests: () => [...requests],
        jevHeaders: () => headers.map((entry) => ({ ...entry })),
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

/** `node integration/mockServices.ts --serve`: keeps the mock Jev answering "nothing flagged" for a manual check until Ctrl-C. */
async function serveFromCli(): Promise<void> {
  const mock = await startMockServices();
  console.log(`mock Jev on :54518 (every Noul ${String(DEFAULT_NOUL)}, every Choice other)`);
  process.once('SIGINT', () => {
    void mock.close().then(() => {
      console.log(`served ${String(mock.jevRequests().length)} Jev call(s)`);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--serve')) {
  serveFromCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
