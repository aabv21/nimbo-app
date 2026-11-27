// `companion` end to end on the local stack: the caller's rows read under RLS, the quota on the local day,
// drafts that write nothing, a note through its RPC, and the screens with Jev (`mockServices.ts`) and Claude
// (`mockAnthropic.ts`) on the host. Needs the Edge Runtime: `pnpm db:start` and `pnpm env:local`.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, type MockReply, startMockAnthropic } from './mockAnthropic';
import { jevAnswersWith, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

type Client = SupabaseClient<Database>;

const PASSWORD = 'Password123!';
const FUNCTION_TIMEOUT_MS = 60_000;
// The edge runtime's container, named after `project_id` in supabase/config.toml.
const EDGE_CONTAINER = 'supabase_edge_runtime_nimbo-app';

const fixture = (name: string): MockReply =>
  JSON.parse(readFileSync(new URL(`fixtures/claude-companion-${name}.json`, import.meta.url), 'utf8')) as MockReply;

let claude: MockAnthropic;
let jev: MockServices;
const users: string[] = [];

beforeAll(async () => {
  [claude, jev] = await Promise.all([startMockAnthropic(), startMockServices()]);
});

afterAll(async () => {
  await Promise.all([claude.close(), jev.close()]);
  await Promise.all(users.map((id) => deleteUser(id)));
});

beforeEach(() => {
  claude.respondWith({ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'no reply set' } } });
  jev.respondJev((body) => ({ status: 200, body: jevAnswersWith(body, {}) }));
});

/** A signed-in user with the AI on, a triptan in the cabinet and an attack with a dose last week. */
async function seededUser(label: string): Promise<{ id: string; email: string; client: Client; medicationId: string; episodeId: string; doseId: string }> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  expect((await client.rpc('accept_terms', { p_adult: true, p_boundary: true })).error).toBeNull();
  expect((await client.rpc('set_ai_consent', { p_enabled: true })).error).toBeNull();
  const medicationId = randomUUID();
  const episodeId = randomUUID();
  const daysAgo = (days: number, hours = 0) => new Date(Date.now() - days * 86_400_000 + hours * 3_600_000).toISOString();
  expect(
    (await client.rpc('save_medication', { p_id: medicationId, p_fields: { name: 'Sumatriptan', kind: 'acute', form: 'oral', class: 'triptan', dose_text: '50 mg at onset' } })).error,
  ).toBeNull();
  expect((await client.rpc('log_episode', { p_id: episodeId, p_started_at: daysAgo(6), p_fields: { ended_at: daysAgo(6, 3), intensity: 6, symptoms: ['nausea'] } })).error).toBeNull();
  const doseId = randomUUID();
  expect((await client.rpc('log_dose', { p_id: doseId, p_medication_id: medicationId, p_taken_at: daysAgo(6, 1), p_episode_id: episodeId })).error).toBeNull();
  return { id, email, client, medicationId, episodeId, doseId };
}

type Invoked = { status: number | undefined; body: Record<string, unknown> | null };

async function invoke(client: Client, body: Record<string, unknown>): Promise<Invoked> {
  const result = await client.functions.invoke<Record<string, unknown>>('companion', { body });
  const { response } = result;
  if (result.error === null) return { status: response?.status, body: result.data };
  const failed = response?.clone();
  return { status: failed?.status, body: failed === undefined ? null : ((await failed.json()) as Record<string, unknown>) };
}

const today = (): string => new Date().toISOString().slice(0, 10);
const message = (text: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  mode: 'chat',
  locale: 'en',
  localDate: today(),
  input: 'text',
  messages: [{ role: 'user', text }],
  ...extra,
});

async function usage(userId: string): Promise<Record<string, number>> {
  const { data, error } = await serviceClient().from('usage_counters').select('kind,count').eq('user_id', userId);
  expect(error).toBeNull();
  return Object.fromEntries((data ?? []).map((row) => [row.kind, row.count]));
}

async function rowCounts(userId: string): Promise<number[]> {
  const service = serviceClient();
  const counts = await Promise.all(
    (['episodes', 'doses', 'checkins'] as const).map(async (table) => {
      const { count, error } = await service.from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
      expect(error).toBeNull();
      return count ?? 0;
    }),
  );
  return counts;
}

/** The function's logged outcome lines since `since`, parsed (they hold words only, never text). */
function loggedSince(since: Date): Record<string, string>[] {
  const result = spawnSync('docker', ['logs', '--since', since.toISOString(), EDGE_CONTAINER], { encoding: 'utf8' });
  return `${result.stdout}\n${result.stderr}`.split('\n').flatMap((line) => {
    const start = line.indexOf('{"outcome"');
    if (start === -1) return [];
    try {
      return [JSON.parse(line.slice(start, line.lastIndexOf('}') + 1)) as Record<string, string>];
    } catch {
      return [];
    }
  });
}

/** Docker's log timestamps have second precision, and the runtime may flush a moment late. */
async function lastOutcome(since: Date): Promise<Record<string, string> | undefined> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const lines = loggedSince(since);
    if (lines.length > 0) return lines.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return undefined;
}

test(
  'a tool round over the cabinet answers, spends one companion unit and writes no record',
  async () => {
    const user = await seededUser('companion-answer');
    const before = await rowCounts(user.id);
    claude.respondWithSequence([fixture('tool-cabinet'), fixture('answer')]);
    const calls = claude.calls();
    const result = await invoke(user.client, message('What is in my cabinet?'));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ reply: 'Your cabinet has your triptan, and a draft is ready for you to check.', guard: 'ok', drafts: [], redFlags: [] });
    expect(claude.calls() - calls).toBe(2);
    expect(await usage(user.id)).toEqual({ screen: 1, companion: 1 });
    expect(await rowCounts(user.id)).toEqual(before);
    // The cabinet went to the model by ref, with the dose text but never the id.
    const second = JSON.stringify(claude.requests().at(-1));
    expect(second).toContain('50 mg at onset');
    expect(second).not.toContain(user.medicationId);
    expect(second).not.toContain(user.id);
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'a voice message spends a dictation unit and a companion unit',
  async () => {
    const user = await seededUser('companion-voice');
    claude.respondWithSequence([fixture('answer')]);
    expect((await invoke(user.client, message('Hello there', { input: 'voice' }))).status).toBe(200);
    expect(await usage(user.id)).toEqual({ screen: 1, companion: 1, dictation: 1 });
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'round 2 carries both cache breakpoints and the fallback header, and the cache reads are logged',
  async () => {
    const user = await seededUser('companion-cache');
    claude.respondWithSequence([fixture('tool-cabinet'), fixture('answer')]);
    const since = new Date(Date.now() - 1_000);
    expect((await invoke(user.client, message('What is in my cabinet?'))).status).toBe(200);
    const round2 = claude.requests().at(-1) as { system: { cache_control?: unknown }[]; cache_control?: unknown; temperature?: unknown };
    expect(round2.system.map((block) => block.cache_control)).toEqual([{ type: 'ephemeral' }, { type: 'ephemeral' }]);
    // The moving breakpoint for the next round's reread of this one's turns.
    expect(round2.cache_control).toEqual({ type: 'ephemeral' });
    expect(round2).not.toHaveProperty('temperature');
    expect(claude.headers().at(-1)).toMatchObject({ 'anthropic-beta': 'server-side-fallback-2026-07-01', 'anthropic-version': '2026-10-21' });
    expect(await lastOutcome(since)).toMatchObject({ outcome: 'answered', rounds: '1', cache_read: '2900' });
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'a propose_dose round returns a dose draft with the real medication id, and writes nothing',
  async () => {
    const user = await seededUser('companion-dose');
    const before = await rowCounts(user.id);
    claude.respondWithSequence([fixture('tool-cabinet'), fixture('propose-dose'), fixture('answer')]);
    const result = await invoke(user.client, message('I took my sumatriptan at 10'));
    expect(result.status).toBe(200);
    expect(result.body?.drafts).toEqual([{ kind: 'dose', ref: 'd1', medicationId: user.medicationId, takenAt: '2026-11-20T15:00:00.000Z', episodeId: null }]);
    expect(await rowCounts(user.id)).toEqual(before);
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'a save_note round creates one agent_notes row',
  async () => {
    const user = await seededUser('companion-note');
    claude.respondWithSequence([fixture('save-note'), fixture('answer')]);
    expect((await invoke(user.client, message('Please keep your answers short'))).status).toBe(200);
    const { data, error } = await user.client.from('agent_notes').select('text');
    expect(error).toBeNull();
    expect(data).toEqual([{ text: 'Prefers short answers' }]);
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'Jev answering g_dose_advice 0.95 replaces the reply',
  async () => {
    const user = await seededUser('companion-replaced');
    let calls = 0;
    jev.respondJev((body) => ({ status: 200, body: jevAnswersWith(body, (calls += 1) === 2 ? { g_dose_advice: 0.95 } : {}) }));
    claude.respondWithSequence([fixture('answer')]);
    const result = await invoke(user.client, message('What should I do?'));
    expect(result.body).toMatchObject({ reply: null, guard: 'replaced', replaced: 'dose_advice', evidence: [] });
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'with Jev down, Haiku screens both ways and the guard source is claude',
  async () => {
    const user = await seededUser('companion-haiku');
    await jev.close();
    try {
      claude.respondWithSequence([fixture('haiku-input'), fixture('answer'), fixture('haiku-reply')]);
      const since = new Date(Date.now() - 1_000);
      const result = await invoke(user.client, message('What is in my cabinet?'));
      expect(result.body).toMatchObject({ guard: 'ok', intent: 'data_question' });
      const models = claude.requests().slice(-3).map((body) => (body as { model: string }).model);
      expect(models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
      expect(await lastOutcome(since)).toMatchObject({ outcome: 'answered', guard_source: 'claude', input_source: 'claude' });
    } finally {
      jev = await startMockServices();
    }
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  'a keyword red flag, in any language, makes no Claude call and spends only a screening unit each',
  async () => {
    const user = await seededUser('companion-red-flag');
    for (const text of ['This is the worst headache of my life', 'pior dor da minha vida']) {
      const calls = claude.calls();
      const result = await invoke(user.client, message(text));
      expect(result.status).toBe(200);
      expect(result.body).toMatchObject({ reply: null, redFlags: ['thunderclap'], drafts: [] });
      expect(claude.calls()).toBe(calls);
    }
    // One usage_counters row of kind 'screen', counted per message; no companion unit.
    expect(await usage(user.id)).toEqual({ screen: 2 });
  },
  FUNCTION_TIMEOUT_MS,
);

const COARSE = { lat: 4.6097, lon: -74.0817 };

test(
  'no request to Claude or Jev carries the email, the coordinates, the user id or any row id',
  async () => {
    const user = await seededUser('companion-privacy');
    expect((await serviceClient().from('profiles').update({ coarse_lat: COARSE.lat, coarse_lon: COARSE.lon }).eq('user_id', user.id)).error).toBeNull();
    const note = await user.client.rpc('save_agent_note', { p_text: 'works night shifts' });
    expect(note.error).toBeNull();
    const claudeBefore = claude.requests().length;
    const jevBefore = jev.jevRequests().length;
    const toolRound: MockReply = {
      status: 200,
      body: {
        type: 'message',
        role: 'assistant',
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'toolu_priv_1', name: 'get_episodes', input: {} },
          { type: 'tool_use', id: 'toolu_priv_2', name: 'get_cabinet', input: {} },
          { type: 'tool_use', id: 'toolu_priv_3', name: 'get_crisis_plan', input: {} },
        ],
      },
    };
    claude.respondWithSequence([toolRound, fixture('propose-dose'), fixture('answer')]);
    const result = await invoke(user.client, message('How were my attacks and my medicines?', { episodeId: user.episodeId }));
    expect(result.status).toBe(200);
    const bodies = [...claude.requests().slice(claudeBefore), ...jev.jevRequests().slice(jevBefore)];
    expect(bodies.length).toBeGreaterThanOrEqual(5);
    const secrets = [user.email, user.id, user.medicationId, user.episodeId, user.doseId, String(note.data), String(COARSE.lat), String(COARSE.lon)];
    for (const body of bodies) {
      const sent = JSON.stringify(body);
      for (const secret of secrets) expect(sent).not.toContain(secret);
    }
    // The ids reach only the app.
    expect(JSON.stringify(result.body)).toContain(user.medicationId);
  },
  FUNCTION_TIMEOUT_MS,
);

test(
  "another user's episode id reads as absent: no attack in the prompt and no ref",
  async () => {
    const owner = await seededUser('companion-owner');
    const other = await seededUser('companion-other');
    claude.respondWithSequence([fixture('answer')]);
    const result = await invoke(other.client, message('Is my attack still going?', { mode: 'crisis', episodeId: owner.episodeId }));
    expect(result.status).toBe(200);
    const block = (claude.requests().at(-1) as { system: { text: string }[] }).system[1]?.text ?? '';
    expect(block).toContain('No attack is open.');
    expect(block).not.toMatch(/\be\d+\b/);
    expect(JSON.stringify(claude.requests().at(-1))).not.toContain(owner.episodeId);
  },
  FUNCTION_TIMEOUT_MS,
);
