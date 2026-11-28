import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Alert, Platform } from 'react-native';

import EpisodeDetail from '../app/episode/[id]';
import EpisodeEdit from '../app/episode/[id]/edit';
import { logDose, setDoseHelped } from '../cabinet/doseStore';
import { saveMedication } from '../cabinet/medicationStore';
import { updateEpisode } from '../episodes/episodeStore';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { formatClock, formatDuration } from '../i18n/format';
import { listOutbox } from '../lib/outbox/outbox';
import { clearUrgentCare, currentUrgentCare } from '../redflags/urgentCare';
import { READY_PROFILE, resetAuth, setAuth } from '../test/authMock';
import { seedEpisode } from '../test/episodeSeed';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: jest.fn() }));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const MED_ID = '00000000-0000-4000-8000-0000000000c1';
// Three days back, so every time here is in the past whatever day the suite runs.
const base = new Date();
const START = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 3, 15, 40);
const END = new Date(START.getTime() + (4 * 60 + 10) * 60 * 1000);

function lastOperation(): { kind: string; args: unknown } | undefined {
  const ops = listOutbox('user-1');
  const last = ops[ops.length - 1];
  return last === undefined ? undefined : { kind: last.kind, args: last.args };
}

function seed(): string {
  const id = seedEpisode('user-1', START, END, {
    intensity: 7,
    painAreas: ['temple_left', 'eye_left'],
    symptoms: ['nausea'],
    triggers: ['short_sleep'],
    reliefs: ['dark_room'],
    notes: 'Started at the office.',
  });
  jest.mocked(useLocalSearchParams).mockReturnValue({ id });
  return id;
}

/** The picker as the OS reports a choice. */
async function pick(date: Date): Promise<void> {
  const picker = screen.getByTestId('datetimepicker');
  await act(() => {
    (picker.props.onValueChange as (event: unknown, value: Date) => void)({ nativeEvent: { timestamp: date.getTime(), utcOffset: 0 } }, date);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearLocalDb();
  clearUrgentCare();
  resetAuth();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('detail', () => {
  test('shows the times with the duration, the intensity and every list as labels', async () => {
    seed();
    await render(<EpisodeDetail />);
    expect(
      screen.getByText(
        t('episode.times', { start: formatClock(START, 'en'), end: formatClock(END, 'en'), duration: formatDuration(250) }),
      ),
    ).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('Left temple')).toBeTruthy();
    expect(screen.getByText('Left eye')).toBeTruthy();
    expect(screen.getByText('Nausea')).toBeTruthy();
    expect(screen.getByText('Short sleep')).toBeTruthy();
    expect(screen.getByText('Dark room')).toBeTruthy();
    expect(screen.getByText('Started at the office.')).toBeTruthy();
    // Nothing is said about a source for an attack typed in by hand.
    expect(screen.queryByText(t('episode.source'))).toBeNull();
  });

  test('lists the doses of the attack as medication and time', async () => {
    const id = seed();
    saveMedication('user-1', MED_ID, {
      name: 'Ibuprofen', kind: 'acute', form: 'oral', medicationClass: 'simple_analgesic', doseText: null, minIntervalHours: null,
      schedule: null, scheduleTime: null, scheduleAnchor: null, archived: false,
    });
    logDose('user-1', { medicationId: MED_ID, takenAt: new Date(START.getTime() + 15 * 60 * 1000), episodeId: id });
    await render(<EpisodeDetail />);
    expect(screen.getByText(t('today.attack.dose_v', { med: 'Ibuprofen', time: formatClock(new Date(START.getTime() + 15 * 60 * 1000), 'en') }))).toBeTruthy();
  });

  test('shows what helped and what did not from the debrief, the medications included', async () => {
    const id = seed();
    saveMedication('user-1', MED_ID, {
      name: 'Ibuprofen', kind: 'acute', form: 'oral', medicationClass: 'simple_analgesic', doseText: null, minIntervalHours: null,
      schedule: null, scheduleTime: null, scheduleAnchor: null, archived: false,
    });
    const doseId = logDose('user-1', { medicationId: MED_ID, takenAt: new Date(START.getTime() + 15 * 60 * 1000), episodeId: id });
    updateEpisode('user-1', id, { helped: ['cold_pack'], didNotHelp: ['water'], debriefed: true });
    setDoseHelped('user-1', doseId, true);
    await render(<EpisodeDetail />);

    const helped = within(screen.getByTestId('episode-helped'));
    expect(helped.getByText(t('episode.helped'))).toBeTruthy();
    expect(helped.getByText('Cold pack')).toBeTruthy();
    expect(helped.getByText('Ibuprofen')).toBeTruthy();
    const notHelped = within(screen.getByTestId('episode-not-helped'));
    expect(notHelped.getByText(t('episode.not_helped'))).toBeTruthy();
    expect(notHelped.getByText('Drinking water')).toBeTruthy();
  });

  test('an attack with no debrief shows no debrief rows', async () => {
    seed();
    await render(<EpisodeDetail />);
    expect(screen.queryByText(t('episode.helped'))).toBeNull();
    expect(screen.queryByText(t('episode.not_helped'))).toBeNull();
  });

  test('Edit opens the editor', async () => {
    const id = seed();
    await render(<EpisodeDetail />);
    await fireEvent.press(screen.getByRole('button', { name: t('common.edit') }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/episode/[id]/edit', params: { id } });
  });

  test('Delete asks first, and only the confirmation deletes the attack and goes back', async () => {
    const id = seed();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<EpisodeDetail />);
    await fireEvent.press(screen.getByRole('button', { name: t('episode.delete') }));

    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0]?.[2] ?? [];
    expect(buttons.map((button) => button.text)).toEqual([t('common.cancel'), t('episode.delete')]);
    expect(lastOperation()?.kind).not.toBe('delete_episode');

    buttons[0]?.onPress?.();
    expect(router.back).not.toHaveBeenCalled();
    await act(() => {
      buttons[1]?.onPress?.();
    });
    expect(lastOperation()).toEqual({ kind: 'delete_episode', args: { p_id: id } });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test('an attack that is not on this phone shows nothing to edit', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'missing' });
    await render(<EpisodeDetail />);
    expect(screen.queryByRole('button', { name: t('episode.delete') })).toBeNull();
    expect(screen.getByRole('button', { name: t('common.back') })).toBeTruthy();
  });
});

describe('edit', () => {
  test('changing the intensity sends the intensity and nothing else', async () => {
    const id = seed();
    await render(<EpisodeEdit />);
    await fireEvent.press(screen.getByRole('radio', { name: '5' }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(lastOperation()).toEqual({ kind: 'update_episode', args: { p_id: id, p_fields: { intensity: 5 } } });
  });

  test('toggling chips and moving the start send only those fields', async () => {
    const id = seed();
    await render(<EpisodeEdit />);
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Vomiting' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Left eye' }));
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(t('episode.start')) }));
    const earlier = new Date(START.getTime() - 30 * 60 * 1000);
    await pick(earlier);
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(lastOperation()).toEqual({
      kind: 'update_episode',
      args: { p_id: id, p_fields: { started_at: earlier.toISOString(), pain_areas: ['temple_left'], symptoms: ['nausea', 'vomiting'] } },
    });
  });

  test('the helped chips save what helped, with the debrief stamp, in the same patch', async () => {
    const id = seed();
    await render(<EpisodeEdit />);
    await fireEvent.press(within(screen.getByTestId('episode-helped')).getByRole('checkbox', { name: 'Cold pack' }));
    await fireEvent.press(screen.getByRole('radio', { name: '5' }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(lastOperation()).toEqual({
      kind: 'update_episode',
      args: { p_id: id, p_fields: { intensity: 5, helped: ['cold_pack'], did_not_help: [], debriefed: true } },
    });
  });

  test('a relief marked as not helping leaves what helped, and the other way round', async () => {
    const id = seed();
    updateEpisode('user-1', id, { helped: ['cold_pack'], debriefed: true });
    await render(<EpisodeEdit />);
    const helped = within(screen.getByTestId('episode-helped'));
    const notHelped = within(screen.getByTestId('episode-not-helped'));
    expect(helped.getByRole('checkbox', { name: 'Cold pack' })).toBeChecked();
    await fireEvent.press(notHelped.getByRole('checkbox', { name: 'Cold pack' }));
    expect(helped.getByRole('checkbox', { name: 'Cold pack' })).not.toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(lastOperation()).toEqual({
      kind: 'update_episode',
      args: { p_id: id, p_fields: { helped: [], did_not_help: ['cold_pack'], debriefed: true } },
    });
  });

  test('Save with nothing changed queues nothing', async () => {
    seed();
    await render(<EpisodeEdit />);
    const before = listOutbox('user-1').length;
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(listOutbox('user-1')).toHaveLength(before);
  });

  test('an end before the start shows the error, blocks Save and sends nothing', async () => {
    seed();
    await render(<EpisodeEdit />);
    const before = listOutbox('user-1').length;
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(t('episode.end')) }));
    await pick(new Date(START.getTime() - 60 * 60 * 1000));

    expect(screen.getByText(t('episode.end.error'))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('common.save') })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(listOutbox('user-1')).toHaveLength(before);

    // Moving it back clears the error.
    await pick(END);
    expect(screen.queryByText(t('episode.end.error'))).toBeNull();
  });

  test('a time the store refuses is shown as an error instead of thrown', async () => {
    seed();
    await render(<EpisodeEdit />);
    const before = listOutbox('user-1').length;
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(t('episode.end')) }));
    await pick(new Date(Date.now() + 24 * 60 * 60 * 1000));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(screen.getByText(t('episode.time.error'))).toBeTruthy();
    expect(listOutbox('user-1')).toHaveLength(before);
    expect(router.back).not.toHaveBeenCalled();
  });

  test('an attack still open can be given an end', async () => {
    const id = seedEpisode('user-1', START, null);
    jest.mocked(useLocalSearchParams).mockReturnValue({ id });
    await render(<EpisodeEdit />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(t('episode.end.set')) }));
    await pick(END);
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(lastOperation()).toEqual({ kind: 'update_episode', args: { p_id: id, p_fields: { ended_at: END.toISOString() } } });
  });

  test('Save confirms, then goes back after a second', async () => {
    jest.useFakeTimers();
    seed();
    await render(<EpisodeEdit />);
    await fireEvent.press(screen.getByRole('radio', { name: '5' }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(screen.getByRole('button', { name: t('common.done') })).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  test.each([
    ['the AI on', true],
    ['the AI off', false],
  ])('notes that describe the worst headache of a life are saved, then urgent care opens on them, with %s', async (_name, aiEnabled) => {
    jest.useFakeTimers();
    setAuth({ profile: { ...READY_PROFILE, aiEnabled } });
    const id = seed();
    await render(<EpisodeEdit />);
    await fireEvent.changeText(screen.getByLabelText(t('episode.notes')), 'worst headache of my life');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    // The note is on the phone and queued before anything else happens.
    expect(lastOperation()).toEqual({ kind: 'update_episode', args: { p_id: id, p_fields: { notes: 'worst headache of my life' } } });
    expect(router.push).not.toHaveBeenCalled();

    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/urgent-care');
    expect(currentUrgentCare()).toMatchObject({ source: 'text', excerpt: 'worst headache of my life' });
  });

  test('urgent care still opens if the screen is left during the confirmation', async () => {
    jest.useFakeTimers();
    seed();
    const view = await render(<EpisodeEdit />);
    await fireEvent.changeText(screen.getByLabelText(t('episode.notes')), 'worst headache of my life');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    await view.unmount();
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/urgent-care');
  });

  test('Close during the confirmation leaves once: one back, one urgent care', async () => {
    jest.useFakeTimers();
    seed();
    await render(<EpisodeEdit />);
    await fireEvent.changeText(screen.getByLabelText(t('episode.notes')), 'worst headache of my life');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
    await act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/urgent-care');
  });

  test('the notes field stops at the 2,000 characters the server keeps', async () => {
    seed();
    await render(<EpisodeEdit />);
    expect(screen.getByLabelText(t('episode.notes'))).toHaveProp('maxLength', 2000);
  });

  test('an ordinary description does not open urgent care', async () => {
    jest.useFakeTimers();
    seed();
    await render(<EpisodeEdit />);
    await fireEvent.changeText(screen.getByLabelText(t('episode.notes')), 'the usual migraine, left temple, nausea');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(router.push).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  test('on Android the date is asked first, then the time, and the result is the new start', async () => {
    const id = seed();
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<EpisodeEdit />);
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(t('episode.start')) }));

    const open = jest.mocked(DateTimePickerAndroid.open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toMatchObject({ mode: 'date' });
    const earlier = new Date(START.getTime() - 60 * 60 * 1000);
    await act(() => {
      open.mock.calls[0]?.[0].onValueChange?.({ nativeEvent: { timestamp: earlier.getTime(), utcOffset: 0 } }, earlier);
    });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open.mock.calls[1]?.[0]).toMatchObject({ mode: 'time', value: earlier });
    await act(() => {
      open.mock.calls[1]?.[0].onValueChange?.({ nativeEvent: { timestamp: earlier.getTime(), utcOffset: 0 } }, earlier);
    });
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(lastOperation()).toEqual({ kind: 'update_episode', args: { p_id: id, p_fields: { started_at: earlier.toISOString() } } });
  });

  test('Cancel leaves without saving', async () => {
    seed();
    await render(<EpisodeEdit />);
    const before = listOutbox('user-1').length;
    await fireEvent.press(screen.getByRole('radio', { name: '5' }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.cancel') }));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(listOutbox('user-1')).toHaveLength(before);
  });
});
