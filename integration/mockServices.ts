// Mock TypeSafe System One (Jev) and Open-Meteo's forecast for the local functions, one server. It listens
// on every interface since the Edge Runtime calls from a container (docs/local-stack.md#mocks).

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';

import type { MockReply } from './mockAnthropic';

export type { MockReply };

/** A Jev reply, or one computed from each request's parsed JSON body (`undefined` if it isn't JSON). */
export type JevReply = MockReply | ((body: unknown) => MockReply);

/** A forecast reply, or one computed from each request's URL. */
export type ForecastReply = MockReply | ((url: URL) => MockReply);

export type MockServices = {
  /** Sets the reply for every following `POST /v1/systemone`, until changed again. */
  respondJev(next: JevReply): void;
  /** Every `POST /v1/systemone` body so far, parsed (`undefined` when it wasn't JSON), oldest first. */
  jevRequests(): unknown[];
  /** The headers of each of those calls, lower-cased, in the same order. */
  jevHeaders(): Record<string, string>[];
  /** Sets the reply for every following valid `GET /v1/forecast`, until changed again. */
  respondForecast(next: ForecastReply): void;
  /** The URL of every `GET /v1/forecast` so far, invalid ones included, oldest first. */
  forecastRequests(): URL[];
  close(): Promise<void>;
};

const JEV_PATH = '/v1/systemone';
const FORECAST_PATH = '/v1/forecast';

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

/** The hour in progress, in UTC. */
function currentHour(): Date {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now;
}

/**
 * An Open-Meteo hourly `pressure_msl` answer for `timezone=GMT`: one hour per value from `from` (a null
 * is an hour the model has no value for), echoing the request's coordinates when `url` is given.
 */
export function pressureForecast(hPa: readonly (number | null)[], from: Date = currentHour(), url?: URL): unknown {
  const start = new Date(from);
  start.setUTCMinutes(0, 0, 0);
  const time = hPa.map((_, index) => new Date(start.getTime() + index * 3_600_000).toISOString().slice(0, 16));
  return {
    latitude: Number(url?.searchParams.get('latitude') ?? 0),
    longitude: Number(url?.searchParams.get('longitude') ?? 0),
    generationtime_ms: 0.05,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: 0,
    hourly_units: { time: 'iso8601', pressure_msl: 'hPa' },
    hourly: { time, pressure_msl: [...hPa] },
  };
}

/** The forecast every request gets unless overridden: flat 1013.0 hPa, as many hours as asked (28 if not). */
const DEFAULT_FORECAST: ForecastReply = (url) => {
  const hours = Number(url.searchParams.get('forecast_hours') ?? 28);
  return { status: 200, body: pressureForecast(Array.from({ length: hours }, () => 1013)) };
};

/** The hourly variables this mock serves; Open-Meteo refuses a name it does not know. */
const HOURLY_VARIABLES = new Set(['pressure_msl']);
/** Open-Meteo's `forecast_hours` ceiling: 16 days. */
const MAX_FORECAST_HOURS = 384;

function validZone(zone: string): boolean {
  if (zone === 'GMT' || zone === 'auto') return true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Open-Meteo's 400 reason for a request it refuses, or null for one it serves. */
function forecastProblem(url: URL): string | null {
  const params = url.searchParams;
  const coordinate = (name: string, limit: number): string | null => {
    const raw = params.get(name);
    if (raw === null) return `Parameter '${name}' is required`;
    const value = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(value)) return `Cannot initialize Float from invalid String value ${raw} for key ${name}`;
    if (Math.abs(value) > limit) return `${name === 'latitude' ? 'Latitude' : 'Longitude'} must be in range of -${String(limit)} to ${String(limit)}°. Given: ${raw}.`;
    return null;
  };
  const coordinates = coordinate('latitude', 90) ?? coordinate('longitude', 180);
  if (coordinates !== null) return coordinates;
  const unknown = (params.get('hourly') ?? '').split(',').find((name) => name !== '' && !HOURLY_VARIABLES.has(name));
  if (unknown !== undefined) return `Cannot initialize ForecastVariable from invalid String value ${unknown} for key hourly`;
  const hours = params.get('forecast_hours');
  if (hours !== null && !(Number.isInteger(Number(hours)) && Number(hours) >= 0 && Number(hours) <= MAX_FORECAST_HOURS)) {
    return `Parameter 'forecast_hours' must be between 0 and ${String(MAX_FORECAST_HOURS)}`;
  }
  const zone = params.get('timezone');
  if (zone !== null && !validZone(zone)) return 'Invalid timezone';
  return null;
}

// `connection: close`: a test's fetch must never reuse a socket of a mock an earlier test closed on this port.
function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
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

function send(response: ServerResponse, reply: MockReply): void {
  if ('hang' in reply) return;
  const { status, body, delayMs } = reply;
  if (delayMs === undefined) {
    sendJson(response, status, body);
    return;
  }
  setTimeout(() => {
    sendJson(response, status, body);
  }, delayMs);
}

/** `make(input)`, or a 500 when it throws (a bad override), so the function under test degrades. */
function replyOf<T>(make: MockReply | ((input: T) => MockReply), input: T): MockReply {
  try {
    return typeof make === 'function' ? make(input) : make;
  } catch (error) {
    return { status: 500, body: { detail: error instanceof Error ? error.message : 'mock reply failed' } };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Starts the mock on `port`. Until a test sets its own reply, Jev answers `jevAnswersWith(body, {})` (nothing
 * flagged) and the forecast is flat 1013.0 hPa from the current UTC hour.
 */
export function startMockServices(port = 54518): Promise<MockServices> {
  let jevReply: JevReply = DEFAULT_JEV;
  let forecastReply: ForecastReply = DEFAULT_FORECAST;
  const requests: unknown[] = [];
  const headers: Record<string, string>[] = [];
  const forecasts: URL[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://mock');
      const path = url.pathname;
      if (request.method === 'GET' && path === FORECAST_PATH) {
        forecasts.push(url);
        const problem = forecastProblem(url);
        send(response, problem === null ? replyOf(forecastReply, url) : { status: 400, body: { error: true, reason: problem } });
        return;
      }
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
      send(response, replyOf(jevReply, body));
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
        respondForecast(next) {
          forecastReply = next;
        },
        forecastRequests: () => forecasts.map((url) => new URL(url)),
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

/** `node integration/mockServices.ts --serve`: keeps the mock Jev answering "nothing flagged" and the flat forecast for a manual check until Ctrl-C. */
async function serveFromCli(): Promise<void> {
  const mock = await startMockServices();
  console.log(`mock Jev and Open-Meteo on :54518 (every Noul ${String(DEFAULT_NOUL)}, every Choice other; 1013.0 hPa every hour)`);
  process.once('SIGINT', () => {
    void mock.close().then(() => {
      console.log(`served ${String(mock.jevRequests().length)} Jev call(s) and ${String(mock.forecastRequests().length)} forecast(s)`);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--serve')) {
  serveFromCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
