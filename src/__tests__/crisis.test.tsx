import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';

import Crisis from '../app/crisis';
import { logDose } from '../cabinet/doseStore';
import { saveMedication } from '../cabinet/medicationStore';
import type { MedicationInput } from '../cabinet/medicationStore';
import { readOpenEpisode, startEpisode } from '../episodes/episodeStore';
import { formatClock, formatDuration } from '../i18n/format';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { localDb } from '../lib/local/db';
import { listOutbox } from '../lib/outbox/outbox';
import { READY_PROFILE, resetAuth } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';
import { ThemeContext } from '../ui/themeContext';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const STARTED = new Date('2026-11-26T18:40:00Z');
const NOW = new Date(STARTED.getTime() + 85 * 60 * 1000);
const IBUPROFEN = '00000000-0000-4000-8000-0000000000a1';
const SUMATRIPTAN = '00000000-0000-4000-8000-0000000000a2';
const MAGNESIUM = '00000000-0000-4000-8000-0000000000a3';

const ACUTE: MedicationInput = {
  name: 'Ibuprofen 400 mg',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'simple_analgesic',
  doseText: null,
  minIntervalHours: 8,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
};

const forceDim = jest.fn();
let episodeId = '';

async function open(): Promise<void> {
  await render(
    <ThemeContext.Provider value={{ name: 'day', reduceMotion: false, forceDim }}>
      <Crisis />
    </ThemeContext.Provider>,
  );
}

function outboxKinds(): string[] {
  return listOutbox('user-1').map((op) => op.kind);
}

function doseRows(): { id: string; medication_id: string; episode_id: string | null; taken_at: string }[] {
  return localDb().getAllSync('SELECT id, medication_id, episode_id, taken_at FROM doses ORDER BY taken_at;');
}

beforeEach(() => {
  // The outbox tells readers about a write in a microtask, which must still run.
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  episodeId = startEpisode('user-1', STARTED);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: episodeId });
});

afterEach(() => {
  jest.useRealTimers();
});

test('mounting forces Dim and keeps the screen awake; unmounting releases Dim', async () => {
  await open();
  expect(forceDim).toHaveBeenLastCalledWith(true);
  expect(useKeepAwake).toHaveBeenCalled();
  await screen.unmount();
  expect(forceDim).toHaveBeenLastCalledWith(false);
});

test('the header says it is saved on this phone, how long it has run and since when', async () => {
  await open();
  expect(screen.getByText(t('crisis.saved_local'))).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('today.status.running') })).toBeOnTheScreen();
  expect(screen.getByText(formatDuration(85))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.since', { time: formatClock(STARTED, 'en') }))).toBeOnTheScreen();
});

test('the intensity is unset until a tap; tapping 7 saves { intensity: 7 }', async () => {
  await open();
  expect(screen.getByText(t('crisis.intensity.unset'))).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: t('crisis.intensity.low') })).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: t('crisis.intensity.high') })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: '7' }));

  expect(listOutbox('user-1').at(-1)).toEqual(
    expect.objectContaining({ kind: 'update_episode', args: { p_id: episodeId, p_fields: { intensity: 7 } } }),
  );
  expect(screen.getByRole('radio', { name: '7' })).toBeChecked();
  expect(screen.queryByText(t('crisis.intensity.unset'))).toBeNull();
  expect(Haptics.selectionAsync).toHaveBeenCalled();
});

test('a symptom chip toggles the symptom on the episode', async () => {
  await open();
  await fireEvent.press(screen.getByRole('checkbox', { name: t('condition.symptoms.nausea') }));
  expect(readOpenEpisode('user-1')?.symptoms).toEqual(['nausea']);
  expect(screen.getByRole('checkbox', { name: t('condition.symptoms.nausea') })).toBeChecked();
});

test('an acute ibuprofen gets a dose button and a preventive magnesium does not', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  saveMedication('user-1', MAGNESIUM, { ...ACUTE, name: 'Magnesium', kind: 'preventive', minIntervalHours: null, schedule: 'daily', scheduleTime: '21:00:00' });
  await open();

  expect(screen.getAllByRole('button', { name: /^Log a dose/ })).toHaveLength(1);
  expect(screen.getByText('Ibuprofen 400 mg')).toBeOnTheScreen();
  expect(screen.queryByText('Magnesium')).toBeNull();
  expect(screen.getByText(t('crisis.dose.none_yet'))).toBeOnTheScreen();
});

test('a dose tap logs it on the episode and shows "Taken at", the countdown and the next time', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Log a dose/ }));

  expect(doseRows()).toEqual([expect.objectContaining({ medication_id: IBUPROFEN, episode_id: episodeId, taken_at: NOW.toISOString() })]);
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Success);
  expect(screen.getByText(t('crisis.dose.taken', { time: formatClock(NOW, 'en') }))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.dose.left', { left: formatDuration(480) }))).toBeOnTheScreen();
  const next = new Date(NOW.getTime() + 480 * 60 * 1000);
  expect(screen.getByText(t('crisis.dose.next', { time: formatClock(next, 'en') }))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.dose.interval', { hours: '8' }))).toBeOnTheScreen();

  // The tick lands on the next minute boundary, never every second.
  await act(async () => {
    await jest.advanceTimersByTimeAsync(60 * 1000);
  });
  expect(screen.getByText(t('crisis.dose.left', { left: formatDuration(479) }))).toBeOnTheScreen();
});

test('the countdown follows the latest dose of that medication in any attack', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  logDose('user-1', { medicationId: IBUPROFEN, takenAt: new Date(NOW.getTime() - 2 * 60 * 60 * 1000), episodeId: null });
  await open();
  expect(screen.getByText(t('crisis.dose.none_yet'))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.dose.left', { left: formatDuration(360) }))).toBeOnTheScreen();
});

test('a triptan with no interval says there is no countdown', async () => {
  saveMedication('user-1', SUMATRIPTAN, { ...ACUTE, name: 'Sumatriptan', medicationClass: 'triptan', minIntervalHours: null });
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Log a dose/ }));
  expect(screen.getByText(t('crisis.dose.no_interval'))).toBeOnTheScreen();
  expect(screen.queryByText(/to go$/)).toBeNull();
});

test('Cancel on a just-logged dose deletes it', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Log a dose/ }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.cancel') }));

  expect(doseRows()).toEqual([]);
  expect(outboxKinds()).toEqual(['log_episode', 'save_medication', 'log_dose', 'delete_dose']);
  expect(screen.getByText(t('crisis.dose.none_yet'))).toBeOnTheScreen();
});

test('Change takes a typed time: bad input shows the error, a good one moves the dose', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Log a dose/ }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.change') }));

  const field = screen.getByLabelText(t('dose.time'));
  await fireEvent.changeText(field, '7.30');
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
  expect(screen.getByText(t('dose.time.error'))).toBeOnTheScreen();

  const earlier = new Date(NOW.getTime() - 30 * 60 * 1000);
  await fireEvent.changeText(field, `${String(earlier.getHours())}:${String(earlier.getMinutes()).padStart(2, '0')}`);
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

  expect(doseRows()).toEqual([expect.objectContaining({ episode_id: episodeId, taken_at: new Date(earlier.setSeconds(0, 0)).toISOString() })]);
  expect(screen.getByText(t('crisis.dose.taken', { time: formatClock(earlier, 'en') }))).toBeOnTheScreen();
});

test('"It’s over" asks first, then ends the attack and shows what was saved', async () => {
  saveMedication('user-1', IBUPROFEN, ACUTE);
  await open();
  await fireEvent.press(screen.getByRole('radio', { name: '6' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Log a dose/ }));
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over') }));

  expect(screen.getByText(t('crisis.over.title'))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.over.body', { time: formatClock(NOW, 'en'), duration: formatDuration(85) }))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.confirm') }));

  expect(readOpenEpisode('user-1')).toBeNull();
  expect(outboxKinds().at(-1)).toBe('end_episode');
  expect(screen.getByRole('header', { name: t('crisis.ended.title') })).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.ended.duration'))).toBeOnTheScreen();
  expect(screen.getByText(formatDuration(85))).toBeOnTheScreen();
  expect(screen.getByText(t('today.attack.dose_v', { med: 'Ibuprofen 400 mg', time: formatClock(NOW, 'en') }))).toBeOnTheScreen();
  expect(screen.queryByText(/Tomorrow morning/)).toBeNull();

  await fireEvent.press(screen.getByRole('button', { name: t('crisis.ended.fill') }));
  expect(router.replace).toHaveBeenCalledWith(`/episode/${episodeId}/edit`);
});

test('"Not yet" closes the question and leaves the attack open', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over') }));
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.not_yet') }));
  expect(screen.queryByText(t('crisis.over.title'))).toBeNull();
  expect(readOpenEpisode('user-1')?.endedAt).toBeNull();
});

test('a changed end time before the start is refused', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over') }));
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.change_time') }));
  const before = new Date(STARTED.getTime() - 10 * 60 * 1000);
  await fireEvent.changeText(
    screen.getByLabelText(t('crisis.over.time')),
    `${String(before.getHours())}:${String(before.getMinutes()).padStart(2, '0')}`,
  );
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.confirm') }));

  expect(screen.getByText(t('crisis.over.time.before', { time: formatClock(STARTED, 'en') }))).toBeOnTheScreen();
  expect(readOpenEpisode('user-1')?.endedAt).toBeNull();
});

test('confirming with an invalid default end shows the inline error instead of throwing', async () => {
  // A start a few minutes ahead (another phone's clock) puts "now" before it.
  localDb().runSync('UPDATE episodes SET started_at = ? WHERE id = ?;', [new Date(NOW.getTime() + 3 * 60 * 1000).toISOString(), episodeId]);
  await open();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over') }));
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.confirm') }));

  expect(screen.getByText(t('crisis.over.time.before', { time: formatClock(new Date(NOW.getTime() + 3 * 60 * 1000), 'en') }))).toBeOnTheScreen();
  expect(readOpenEpisode('user-1')?.endedAt).toBeNull();
  expect(outboxKinds()).toEqual(['log_episode']);
});

test('with the AI off, the symptoms say everything is logged with taps', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await open();
  expect(screen.getByText(t('crisis.ai_off'))).toBeOnTheScreen();
});

test('with the AI on, that line is absent', async () => {
  await open();
  expect(screen.queryByText('Without the AI, everything is logged with taps.')).toBeNull();
});

test('Hide closes crisis mode and leaves the attack open', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.hide.aria') }));
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(readOpenEpisode('user-1')).toEqual(expect.objectContaining({ id: episodeId, endedAt: null }));
});

test('"Where it hurts" opens the head map, and Done returns with the areas saved', async () => {
  await open();
  await fireEvent.press(screen.getByRole('button', { name: /^Mark it on the head/ }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('condition.painAreas.temple_left') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.done') }));

  expect(readOpenEpisode('user-1')?.painAreas).toEqual(['temple_left']);
  expect(screen.getByText(t('condition.painAreas.temple_left'))).toBeOnTheScreen();
});

test('without the AI this wave, "Tell me" and "What helped before" are absent', async () => {
  await open();
  expect(screen.queryByText('Tell me')).toBeNull();
  expect(screen.queryByText('What helped before')).toBeNull();
});
