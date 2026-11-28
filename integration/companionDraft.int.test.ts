// A dictated message all the way to History: the companion's drafts (Claude and Jev mocked on the host), Confirm
// through applyDraft and the outbox, the real RPCs on the local stack, then the pull History reads.

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { signInWithEmail } from '../src/auth/emailAuth';
import { applyDraft } from '../src/companion/applyDraft';
import { askCompanion } from '../src/companion/companionClient';
import type { Draft } from '../src/companion/contract';
import { localDateIn } from '../src/condition';
import { readEpisode } from '../src/episodes/episodeStore';
import { localDb } from '../src/lib/local/db';
import { listOutbox } from '../src/lib/outbox/outbox';
import { rpcSender, runOutbox } from '../src/lib/outbox/runOutbox';
import { pullAll } from '../src/lib/sync/pull';
import { clearLocalDb } from '../src/test/localDbTest';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockAnthropic, type MockReply, startMockAnthropic } from './mockAnthropic';
import { jevAnswersWith, type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const FUNCTION_TIMEOUT_MS = 60_000;
const TIME_ZONE = 'America/Bogota';
// The edge runtime and the test read the same host clock, within this much.
const CLOCK_SLACK_MS = 2_000;

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
  clearLocalDb();
  jev.respondJev((body) => ({ status: 200, body: jevAnswersWith(body, {}) }));
});

/** The round a model makes after reading block 2: an attack and a dose, both "just now" on the clock it was given. */
function draftsAtNow(body: unknown): MockReply {
  const block = (body as { system: { text: string }[] }).system[1]?.text ?? '';
  const now = /It is now (\S+) \(/.exec(block)?.[1] ?? 'missing';
  return {
    status: 200,
    body: {
      type: 'message',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'toolu_e2e_episode', name: 'propose_episode', input: { started_at: now, intensity: 6 } },
        { type: 'tool_use', id: 'toolu_e2e_dose', name: 'propose_dose', input: { medication_ref: 'm1', taken_at: now } },
      ],
    },
  };
}

test(
  'a dictated message becomes drafts, Confirm sends them through the outbox, and History reads them back as voice',
  async () => {
    const email = uniqueEmail('companion-e2e');
    const userId = await createUser(email, PASSWORD);
    users.push(userId);
    const client = anonClient();
    expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
    expect((await client.rpc('accept_terms', { p_adult: true, p_boundary: true })).error).toBeNull();
    expect((await client.rpc('set_ai_consent', { p_enabled: true })).error).toBeNull();
    expect((await serviceClient().from('profiles').update({ timezone: TIME_ZONE }).eq('user_id', userId)).error).toBeNull();
    const medicationId = randomUUID();
    expect((await client.rpc('save_medication', { p_id: medicationId, p_fields: { name: 'Sumatriptan', kind: 'acute', form: 'oral', class: 'triptan' } })).error).toBeNull();
    expect(await pullAll(userId, client)).toEqual({ ok: true, value: undefined });

    claude.respondWithSequence([fixture('tool-cabinet'), draftsAtNow, fixture('answer')]);
    const before = Date.now();
    const outcome = await askCompanion(
      {
        mode: 'chat',
        locale: 'en',
        localDate: localDateIn(new Date(), TIME_ZONE),
        input: 'voice',
        messages: [{ role: 'user', text: 'The attack started just now and I just took my sumatriptan' }],
      },
      client,
    );
    const after = Date.now();
    if (!outcome.ok) throw new Error(`companion answered ${outcome.error}`);
    const { drafts } = outcome.result;
    expect(drafts.map((draft) => draft.kind)).toEqual(['episode', 'dose']);
    const dose = drafts.find((draft): draft is Extract<Draft, { kind: 'dose' }> => draft.kind === 'dose');
    const episode = drafts.find((draft): draft is Extract<Draft, { kind: 'episode' }> => draft.kind === 'episode');
    if (dose === undefined || episode === undefined || episode.startedAt === null) throw new Error('missing drafts');
    expect(dose.medicationId).toBe(medicationId);
    // "Now" to the second, on the clock block 2 gave the model.
    const takenAt = Date.parse(dose.takenAt);
    expect(takenAt).toBeGreaterThanOrEqual(before - CLOCK_SLACK_MS);
    expect(takenAt).toBeLessThanOrEqual(after + CLOCK_SLACK_MS);

    // Confirm, as useCompanion does for a dictated message: each draft in its own transaction, with ids made here.
    const ids = { episode: randomUUID(), dose: randomUUID() };
    localDb().withTransactionSync(() => {
      applyDraft(userId, episode, { recordId: ids.episode, doseIds: [] }, 'voice');
    });
    localDb().withTransactionSync(() => {
      applyDraft(userId, dose, { recordId: ids.dose, doseIds: [] }, 'voice');
    });
    expect(listOutbox(userId).map((op) => op.kind)).toEqual(['log_episode', 'log_dose']);
    await runOutbox(userId, { send: rpcSender(client), sessionUserId: () => userId, now: Date.now });
    expect(listOutbox(userId)).toEqual([]);

    const service = serviceClient();
    const serverDose = await service.from('doses').select('medication_id,taken_at,episode_id').eq('id', ids.dose).single();
    expect(serverDose.error).toBeNull();
    expect(Date.parse(serverDose.data?.taken_at ?? '')).toBe(takenAt);
    expect(serverDose.data).toMatchObject({ medication_id: medicationId, episode_id: null });
    const serverEpisode = await service.from('episodes').select('source,started_at,ended_at').eq('id', ids.episode).single();
    expect(serverEpisode.error).toBeNull();
    expect(serverEpisode.data).toMatchObject({ source: 'voice', ended_at: null });
    expect(Date.parse(serverEpisode.data?.started_at ?? '')).toBe(Date.parse(episode.startedAt));

    // A fresh phone: History reads only what the pull brought back.
    clearLocalDb();
    expect(await pullAll(userId, client)).toEqual({ ok: true, value: undefined });
    expect(readEpisode(userId, ids.episode)).toMatchObject({ source: 'voice', endedAt: null, intensity: 6 });
    const pulled = localDb().getAllSync<{ id: string; taken_at: string }>('SELECT id, taken_at FROM doses WHERE user_id = ?;', [userId]);
    expect(pulled.map((row) => [row.id, Date.parse(row.taken_at)])).toEqual([[ids.dose, takenAt]]);
  },
  FUNCTION_TIMEOUT_MS,
);
