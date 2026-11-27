import { startEpisode } from '../../episodes/episodeStore';
import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import { applyDraft } from '../applyDraft';
import type { CheckinDraft, DoseDraft, EpisodeDraft } from '../contract';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));

const NOW = new Date('2026-11-27T18:00:00Z');
const USER = 'user-a';
const MED = '00000000-0000-4000-8000-0000000000a1';
const RECORD = '00000000-0000-4000-8000-0000000000e1';
const DOSE = '00000000-0000-4000-8000-0000000000d1';

const NEW_EPISODE: EpisodeDraft = {
  kind: 'episode',
  ref: 'd1',
  episodeId: null,
  startedAt: '2026-11-26T21:00:00.000Z',
  endedAt: '2026-11-27T02:00:00.000Z',
  intensity: 7,
  painAreas: [],
  symptoms: [],
  triggers: [],
  reliefs: [],
  helped: [],
  didNotHelp: [],
  doses: [{ medicationId: MED, takenAt: '2026-11-26T22:00:00.000Z' }],
};

const EMPTY_CHECKIN: CheckinDraft = {
  kind: 'checkin',
  ref: 'd1',
  localDate: '2026-11-27',
  sleepBand: null,
  sleepQuality: null,
  stress: null,
  lowWater: null,
  extraCaffeine: null,
  alcohol: null,
  skippedMeal: null,
  screenHeavy: null,
};

function ops(): { kind: string; args: unknown }[] {
  return listOutbox(USER).map((op) => ({ kind: op.kind, args: op.args }));
}

/** Like `confirm`: the draft runs inside the caller's one transaction. */
function apply(draft: Parameters<typeof applyDraft>[1], ids: Parameters<typeof applyDraft>[2]): void {
  localDb().withTransactionSync(() => {
    applyDraft(USER, draft, ids, 'chat');
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate', 'setTimeout', 'clearTimeout'] });
  clearLocalDb();
});

afterEach(() => {
  jest.useRealTimers();
});

test('a new episode with one dose logs the episode (source chat) then the dose, with the given ids', () => {
  apply(NEW_EPISODE, { recordId: RECORD, doseIds: [DOSE] });
  expect(ops()).toEqual([
    {
      kind: 'log_episode',
      args: { p_id: RECORD, p_started_at: NEW_EPISODE.startedAt, p_fields: { ended_at: NEW_EPISODE.endedAt, intensity: 7, source: 'chat' } },
    },
    { kind: 'log_dose', args: { p_id: DOSE, p_medication_id: MED, p_taken_at: '2026-11-26T22:00:00.000Z', p_episode_id: RECORD } },
  ]);
});

test('a new episode with helped also saves the debrief: an update_episode with debriefed true', () => {
  apply({ ...NEW_EPISODE, doses: [], helped: ['dark_room'] }, { recordId: RECORD, doseIds: [] });
  const kinds = ops().map((op) => op.kind);
  expect(kinds).toEqual(['log_episode', 'update_episode']);
  expect(ops()[1]?.args).toEqual({ p_id: RECORD, p_fields: { helped: ['dark_room'], did_not_help: [], triggers: [], debriefed: true } });
});

test('a draft on the open episode with an end updates and ends it in one patch', () => {
  const open = startEpisode(USER, new Date('2026-11-27T15:00:00Z'));
  const before = listOutbox(USER).length;
  apply(
    { ...NEW_EPISODE, episodeId: open, startedAt: null, endedAt: '2026-11-27T17:30:00.000Z', intensity: 6, triggers: ['stress'], doses: [] },
    { recordId: RECORD, doseIds: [] },
  );
  expect(ops().slice(before)).toEqual([
    { kind: 'update_episode', args: { p_id: open, p_fields: { ended_at: '2026-11-27T17:30:00.000Z', intensity: 6, triggers: ['stress'] } } },
  ]);
});

test('a draft that moves an ended attack past its old end, with a new end, is one valid update', () => {
  const id = startEpisode(USER, new Date('2026-11-27T08:00:00Z'));
  localDb().withTransactionSync(() => {
    applyDraft(USER, { ...NEW_EPISODE, episodeId: id, startedAt: null, endedAt: '2026-11-27T09:00:00.000Z', intensity: null, doses: [] }, { recordId: RECORD, doseIds: [] }, 'chat');
  });
  const before = listOutbox(USER).length;
  apply(
    { ...NEW_EPISODE, episodeId: id, startedAt: '2026-11-27T13:00:00.000Z', endedAt: '2026-11-27T15:00:00.000Z', intensity: null, doses: [] },
    { recordId: RECORD, doseIds: [] },
  );
  expect(ops().slice(before)).toEqual([
    { kind: 'update_episode', args: { p_id: id, p_fields: { started_at: '2026-11-27T13:00:00.000Z', ended_at: '2026-11-27T15:00:00.000Z' } } },
  ]);
});

test('a draft on an existing episode adds its tags to those already logged', () => {
  const open = startEpisode(USER, new Date('2026-11-27T15:00:00Z'));
  apply({ ...NEW_EPISODE, episodeId: open, startedAt: null, endedAt: null, intensity: null, triggers: ['stress'], doses: [] }, { recordId: RECORD, doseIds: [] });
  apply({ ...NEW_EPISODE, episodeId: open, startedAt: null, endedAt: null, intensity: null, triggers: ['skipped_meal'], doses: [] }, { recordId: RECORD, doseIds: [] });
  expect(ops().at(-1)?.args).toEqual({ p_id: open, p_fields: { triggers: ['stress', 'skipped_meal'] } });
});

test('a check-in draft sends only the fields that were said', () => {
  apply({ ...EMPTY_CHECKIN, stress: 'high' }, { recordId: RECORD, doseIds: [] });
  expect(ops()).toEqual([{ kind: 'save_checkin', args: { p_local_date: '2026-11-27', p_fields: { stress: 'high' } } }]);
});

test('a dose draft logs the dose with the given record id, not a fresh one', () => {
  const draft: DoseDraft = { kind: 'dose', ref: 'd1', medicationId: MED, takenAt: '2026-11-27T17:00:00.000Z', episodeId: null };
  apply(draft, { recordId: RECORD, doseIds: [] });
  expect(ops()).toEqual([{ kind: 'log_dose', args: { p_id: RECORD, p_medication_id: MED, p_taken_at: '2026-11-27T17:00:00.000Z' } }]);
});

test('a new episode with no start is a RangeError, and the transaction writes nothing', () => {
  expect(() => {
    apply({ ...NEW_EPISODE, startedAt: null }, { recordId: RECORD, doseIds: [DOSE] });
  }).toThrow(RangeError);
  expect(ops()).toEqual([]);
});
