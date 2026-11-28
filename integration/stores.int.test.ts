// The real stores, drained against the running local stack: what each screen writes and queues reaches the
// server as the same rows, in order, and leaves the outbox empty.

import { logDose, setDoseHelped } from '../src/cabinet/doseStore';
import { saveMedication } from '../src/cabinet/medicationStore';
import { saveCheckin } from '../src/checkin/checkinStore';
import { endEpisode, logEpisode, saveDebrief, startEpisode, updateEpisode } from '../src/episodes/episodeStore';
import { signInWithEmail } from '../src/auth/emailAuth';
import { localDb } from '../src/lib/local/db';
import { listOutbox } from '../src/lib/outbox/outbox';
import { rpcSender, runOutbox } from '../src/lib/outbox/runOutbox';
import { pullAll } from '../src/lib/sync/pull';
import { completeOnboarding } from '../src/profile/profileRepository';
import { clearLocalDb } from '../src/test/localDbTest';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const users: string[] = [];

beforeEach(clearLocalDb);

afterAll(async () => {
  await Promise.all(users.map((id) => deleteUser(id)));
});

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

test('an attack, a medication, a dose, an edit, the end, a check-in and the end of onboarding reach the server as written', async () => {
  const email = uniqueEmail('stores');
  const userId = await createUser(email, PASSWORD);
  users.push(userId);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  // Onboarding finishes only once both consent gates are answered, as they are by the setup steps.
  expect((await client.rpc('accept_terms', { p_adult: true, p_boundary: true, p_health: true, p_version: '2026-12-01', p_locale: 'en' })).error).toBeNull();
  expect((await client.rpc('set_ai_consent', { p_enabled: false, p_version: '2026-12-01', p_locale: 'en' })).error).toBeNull();

  const episodeId = startEpisode(userId, minutesAgo(90));
  const medicationId = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
  saveMedication(userId, medicationId, {
    name: '  Sumatriptan  ',
    kind: 'acute',
    form: 'oral',
    medicationClass: 'triptan',
    doseText: null,
    minIntervalHours: null,
    schedule: null,
    scheduleTime: null,
    scheduleAnchor: null,
    archived: false,
  });
  const doseId = logDose(userId, { medicationId, takenAt: minutesAgo(60), episodeId });
  const movedStart = minutesAgo(120);
  updateEpisode(userId, episodeId, { startedAt: movedStart.toISOString(), notes: 'left temple, nausea' });
  const endedAt = minutesAgo(5);
  endEpisode(userId, episodeId, endedAt);
  const today = new Date().toISOString().slice(0, 10);
  saveCheckin(userId, today, { sleepBand: '6_7', stress: 'mid', alcohol: true });
  completeOnboarding(userId);

  expect(listOutbox(userId).map((op) => op.kind)).toEqual([
    'log_episode',
    'save_medication',
    'log_dose',
    'update_episode',
    'end_episode',
    'save_checkin',
    'complete_onboarding',
  ]);
  expect(await runOutbox(userId, { send: rpcSender(client), sessionUserId: () => userId })).toEqual({ sent: 7, failed: 0, waiting: 0 });
  expect(listOutbox(userId)).toEqual([]);

  const { data: episode } = await client.from('episodes').select('started_at, ended_at, notes, source').eq('id', episodeId).single();
  expect(episode).not.toBeNull();
  expect(new Date(episode?.started_at ?? '').getTime()).toBe(movedStart.getTime());
  expect(new Date(episode?.ended_at ?? '').getTime()).toBe(endedAt.getTime());
  expect(episode).toEqual(expect.objectContaining({ notes: 'left temple, nausea', source: 'manual' }));

  const { data: medication } = await client
    .from('medications')
    .select('name, kind, class, dose_text, min_interval_minutes, schedule, archived_at')
    .eq('id', medicationId)
    .single();
  expect(medication).toEqual({
    name: 'Sumatriptan',
    kind: 'acute',
    class: 'triptan',
    dose_text: null,
    min_interval_minutes: null,
    schedule: null,
    archived_at: null,
  });

  const { data: dose } = await client.from('doses').select('medication_id, episode_id').eq('id', doseId).single();
  expect(dose).toEqual({ medication_id: medicationId, episode_id: episodeId });

  const { data: checkin } = await client.from('checkins').select('sleep_band, stress, alcohol, low_water').eq('local_date', today).single();
  expect(checkin).toEqual({ sleep_band: '6_7', stress: 'mid', alcohol: true, low_water: false });

  const { data: profile } = await client.from('profiles').select('onboarding_completed_at').single();
  expect(profile?.onboarding_completed_at).not.toBeNull();
});

test('a chat-logged attack, its doses and the debrief reach the server, and a replay changes nothing', async () => {
  const email = uniqueEmail('debrief');
  const userId = await createUser(email, PASSWORD);
  users.push(userId);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });

  const medicationId = '7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
  saveMedication(userId, medicationId, {
    name: 'Ibuprofen',
    kind: 'acute',
    form: 'oral',
    medicationClass: 'simple_analgesic',
    doseText: null,
    minIntervalHours: null,
    schedule: null,
    scheduleTime: null,
    scheduleAnchor: null,
    archived: false,
  });
  const episodeId = '8b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
  logEpisode(userId, episodeId, {
    startedAt: minutesAgo(300).toISOString(),
    endedAt: minutesAgo(120).toISOString(),
    source: 'chat',
    triggers: ['stress'],
  });
  const helpedDose = logDose(userId, { id: '9c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f', medicationId, takenAt: minutesAgo(280), episodeId });
  const otherDose = logDose(userId, { medicationId, takenAt: minutesAgo(200), episodeId });
  setDoseHelped(userId, otherDose, true);
  saveDebrief(userId, episodeId, {
    helped: ['dark_room'],
    didNotHelp: ['caffeine'],
    triggers: ['short_sleep'],
    doseHelped: { [helpedDose]: true },
  });
  setDoseHelped(userId, otherDose, null);

  const send = rpcSender(client);
  expect(await runOutbox(userId, { send, sessionUserId: () => userId })).toEqual({ sent: 8, failed: 0, waiting: 0 });

  const { data: episode } = await client
    .from('episodes')
    .select('source, triggers, helped, did_not_help, debriefed_at')
    .eq('id', episodeId)
    .single();
  expect(episode).toEqual(
    expect.objectContaining({ source: 'chat', triggers: ['stress', 'short_sleep'], helped: ['dark_room'], did_not_help: ['caffeine'] }),
  );
  const stamped = episode?.debriefed_at ?? null;
  expect(stamped).not.toBeNull();
  const { data: doses } = await client.from('doses').select('id, helped').eq('episode_id', episodeId).order('taken_at');
  expect(doses).toEqual([
    { id: helpedDose, helped: true },
    { id: otherDose, helped: null },
  ]);

  // The same debrief and dose sent again, as after a lost reply: nothing moves, the first stamp included.
  expect((await client.rpc('update_episode', { p_id: episodeId, p_fields: { helped: ['dark_room'], debriefed: true } })).error).toBeNull();
  expect((await client.rpc('log_dose', { p_id: helpedDose, p_medication_id: medicationId, p_taken_at: minutesAgo(10).toISOString() })).error).toBeNull();
  const { data: again } = await client.from('episodes').select('debriefed_at').eq('id', episodeId).single();
  expect(again?.debriefed_at).toBe(stamped);

  expect(await pullAll(userId, client)).toEqual({ ok: true, value: undefined });
  expect(localDb().getFirstSync('SELECT helped, did_not_help, dirty FROM episodes WHERE id = ?;', [episodeId])).toEqual({
    helped: '["dark_room"]',
    did_not_help: '["caffeine"]',
    dirty: 0,
  });
  expect(localDb().getFirstSync('SELECT helped FROM doses WHERE id = ?;', [helpedDose])).toEqual({ helped: 1 });
});
