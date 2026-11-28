import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import Companion from '../../app/(tabs)/companion';
import { logDose } from '../../cabinet/doseStore';
import { saveMedication } from '../../cabinet/medicationStore';
import { readEpisode, saveDebrief } from '../../episodes/episodeStore';
import type { Episode } from '../../episodes/episodeStore';
import { translate } from '../../i18n';
import type { MessageKey, Params } from '../../i18n';
import Storage from 'expo-sqlite/kv-store';

import { kvRemove } from '../../lib/kv';
import { localDate } from '../../lib/localDate';
import { listOutbox } from '../../lib/outbox/outbox';
import { resetAuth } from '../../test/authMock';
import { seedEpisode } from '../../test/episodeSeed';
import { clearLocalDb } from '../../test/localDbTest';
import { readChat } from '../chatStore';
import { askCompanion } from '../companionClient';
import { DebriefCard } from '../DebriefCard';
import { debriefDoneKey, readDebriefsDone } from '../debriefDone';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../companionClient', () => ({
  ...jest.requireActual<typeof import('../companionClient')>('../companionClient'),
  askCompanion: jest.fn(),
}));
jest.mock('../../episodes/episodeStore', () => {
  const actual = jest.requireActual<typeof import('../../episodes/episodeStore')>('../../episodes/episodeStore');
  return { ...actual, saveDebrief: jest.fn(actual.saveDebrief) };
});

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const USER = 'user-1';
// 08:00 on the device's day; the attack ran 15:00 to 19:10 the day before.
const NOW = new Date(2026, 10, 27, 8, 0);
const START = new Date(2026, 10, 26, 15, 0);
const END = new Date(2026, 10, 26, 19, 10);
const IBUPROFEN = '00000000-0000-4000-8000-0000000000a1';

function seed(): { episode: Episode; doseId: string } {
  saveMedication(USER, IBUPROFEN, {
    name: 'Ibuprofen 400 mg', kind: 'acute', form: 'oral', medicationClass: 'simple_analgesic', doseText: null, minIntervalHours: 8,
    schedule: null, scheduleTime: null, scheduleAnchor: null, archived: false,
  });
  const id = seedEpisode(USER, START, END, { reliefs: ['dark_room'] });
  const doseId = logDose(USER, { medicationId: IBUPROFEN, takenAt: new Date(2026, 10, 26, 15, 20), episodeId: id });
  const episode = readEpisode(USER, id);
  if (episode === null) throw new Error('not seeded');
  return { episode, doseId };
}

function lastOf(kind: string): unknown {
  return listOutbox(USER).filter((op) => op.kind === kind).at(-1)?.args;
}

const onSaved = jest.fn();
const onClosed = jest.fn();

async function renderCard(episode: Episode): Promise<void> {
  await render(<DebriefCard userId={USER} episode={episode} now={NOW} onSaved={onSaved} onClosed={onClosed} />);
}

async function answer(labels: readonly string[]): Promise<void> {
  for (const label of labels) await fireEvent.press(screen.getByRole('checkbox', { name: label }));
  await fireEvent.press(screen.getByTestId('debrief-send'));
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  for (const kind of ['companion', 'dictation']) kvRemove(`companion.quota.${kind}.${USER}.${localDate(NOW)}`);
  kvRemove(debriefDoneKey(USER));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('the greeting names yesterday and the attack’s duration, and shows question 1 of 3', async () => {
  const { episode } = seed();
  await renderCard(episode);
  expect(screen.getByText(t('debrief.q.helped.yesterday', { duration: '4 h 10 min' }))).toBeTruthy();
  expect(t('debrief.q.helped.yesterday', { duration: '4 h 10 min' })).toContain('Yesterday you had an attack of 4 h 10 min');
  expect(screen.getByText(t('debrief.progress', { n: 1, of: 3 }))).toBeTruthy();
  // The attack's own relief and its medication come first; "Nothing" is there too.
  expect(screen.getByRole('checkbox', { name: 'Dark room' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: 'Ibuprofen 400 mg' })).toBeTruthy();
  expect(screen.getByRole('checkbox', { name: t('debrief.none') })).toBeTruthy();
});

test('the answers of the three steps are saved together, the dose marked as helped, and the closing line follows', async () => {
  const { episode, doseId } = seed();
  await renderCard(episode);
  await answer(['Dark room', 'Ibuprofen 400 mg']);

  expect(screen.getByText(t('debrief.q.not_helped'))).toBeTruthy();
  expect(screen.getByText(t('debrief.progress', { n: 2, of: 3 }))).toBeTruthy();
  // What helped is not offered again.
  expect(screen.queryByRole('checkbox', { name: 'Dark room' })).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'Ibuprofen 400 mg' })).toBeNull();
  await answer(['Caffeine']);

  expect(screen.getByText(t('debrief.q.triggers'))).toBeTruthy();
  expect(saveDebrief).not.toHaveBeenCalled();
  await answer(['Stress']);

  expect(saveDebrief).toHaveBeenCalledTimes(1);
  expect(saveDebrief).toHaveBeenCalledWith(USER, episode.id, {
    helped: ['dark_room'],
    didNotHelp: ['caffeine'],
    triggers: ['stress'],
    doseHelped: { [doseId]: true },
  });
  expect(lastOf('update_episode')).toEqual({
    p_id: episode.id,
    p_fields: { helped: ['dark_room'], did_not_help: ['caffeine'], triggers: ['stress'], debriefed: true },
  });
  expect(lastOf('set_dose_helped')).toEqual({ p_id: doseId, p_helped: true });
  expect(readDebriefsDone(USER).has(episode.id)).toBe(true);

  // M11: the press shows it saved, held a second before the closing line.
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: t('common.done') })).toBeTruthy();
  expect(readChat(USER)).toHaveLength(0);
  await act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(readChat(USER)).toMatchObject([{ role: 'assistant', template: 'debrief_done', mode: 'debrief', text: '' }]);
  expect(onClosed).toHaveBeenCalledTimes(1);
});

test('an attack from two days ago is named by its date', async () => {
  const id = seedEpisode(USER, new Date(2026, 10, 25, 9, 0), new Date(2026, 10, 25, 9, 45));
  const episode = readEpisode(USER, id);
  if (episode === null) throw new Error('not seeded');
  await renderCard(episode);
  expect(screen.getByText('You had an attack of 45 min on November 25. What helped?')).toBeTruthy();
});

test('a second tap on the last Send saves once', async () => {
  const { episode } = seed();
  await renderCard(episode);
  await fireEvent.press(screen.getByTestId('debrief-skip'));
  await fireEvent.press(screen.getByTestId('debrief-skip'));
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Stress' }));
  const send = screen.getByTestId('debrief-send');
  await fireEvent.press(send);
  await fireEvent.press(send);
  expect(saveDebrief).toHaveBeenCalledTimes(1);
  expect(listOutbox(USER).filter((op) => op.kind === 'update_episode' && JSON.stringify(op.args).includes('debriefed'))).toHaveLength(1);
});

test('a kv store that fails still ends the debrief: saved once, confirmed, closed', async () => {
  const { episode } = seed();
  jest.spyOn(Storage, 'setItemSync').mockImplementation(() => {
    throw new Error('disk full');
  });
  await renderCard(episode);
  for (let step = 0; step < 3; step += 1) await fireEvent.press(screen.getByTestId('debrief-skip'));
  expect(saveDebrief).toHaveBeenCalledTimes(1);
  expect(readEpisode(USER, episode.id)?.debriefedAt).not.toBeNull();
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(t('boundary.error'))).toBeNull();
  // Saved for good: a further tap on Done saves nothing more.
  await fireEvent.press(screen.getByRole('button', { name: t('common.done') }));
  expect(saveDebrief).toHaveBeenCalledTimes(1);
  await act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(onClosed).toHaveBeenCalledTimes(1);
  expect(readChat(USER)).toMatchObject([{ template: 'debrief_done' }]);
});

test('a medication that did not help is saved as not helping', async () => {
  const { episode, doseId } = seed();
  await renderCard(episode);
  await fireEvent.press(screen.getByTestId('debrief-skip'));
  await answer(['Ibuprofen 400 mg']);
  await fireEvent.press(screen.getByTestId('debrief-skip'));
  expect(saveDebrief).toHaveBeenCalledWith(USER, episode.id, { helped: [], didNotHelp: [], triggers: [], doseHelped: { [doseId]: false } });
});

test('Skip on every step still stamps the attack as debriefed, with empty answers', async () => {
  const { episode } = seed();
  await renderCard(episode);
  for (let step = 0; step < 3; step += 1) await fireEvent.press(screen.getByTestId('debrief-skip'));

  expect(saveDebrief).toHaveBeenCalledWith(USER, episode.id, { helped: [], didNotHelp: [], triggers: [], doseHelped: {} });
  expect(lastOf('update_episode')).toEqual({ p_id: episode.id, p_fields: { helped: [], did_not_help: [], triggers: [], debriefed: true } });
  expect(readEpisode(USER, episode.id)?.debriefedAt).not.toBeNull();
});

test('“Nothing” clears the other picks, and a pick clears “Nothing”', async () => {
  const { episode } = seed();
  await renderCard(episode);
  expect(screen.getByTestId('debrief-send')).toBeDisabled();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Dark room' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('debrief.none') }));
  expect(screen.getByRole('checkbox', { name: 'Dark room' })).not.toBeChecked();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Cold pack' }));
  expect(screen.getByRole('checkbox', { name: t('debrief.none') })).not.toBeChecked();
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Cold pack' }));
  await answer([t('debrief.none')]);
  // "Nothing" answered: the next step is asked, nothing is recorded for this one.
  expect(screen.getByText(t('debrief.q.not_helped'))).toBeTruthy();
});

describe('in the Companion tab', () => {
  const mockedAsk = jest.mocked(askCompanion);
  // The composer's Send, not the card's.
  const composerSend = (): ReturnType<typeof screen.getByTestId> => {
    const button = screen.getAllByRole('button', { name: t('companion.send') }).find((item) => item.props.testID !== 'debrief-send');
    if (button === undefined) throw new Error('no composer Send');
    return button;
  };

  test('a due debrief shows in the tab, and typed text goes in debrief mode with the attack', async () => {
    const { episode } = seed();
    mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await render(<Companion />);
    expect(screen.getByText(t('debrief.q.helped.yesterday', { duration: '4 h 10 min' }))).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'The dark room helped a lot');
    await fireEvent.press(composerSend());
    expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ mode: 'debrief', episodeId: episode.id }));
  });

  test('typing “worst headache of my life” during the debrief opens urgent care and sends nothing', async () => {
    seed();
    await render(<Companion />);
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'worst headache of my life');
    await fireEvent.press(composerSend());
    expect(router.push).toHaveBeenCalledWith('/urgent-care');
    expect(mockedAsk).not.toHaveBeenCalled();
  });

  test('once the steps are answered, a message sent while the saved confirmation shows goes in chat mode', async () => {
    seed();
    mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await render(<Companion />);
    for (let step = 0; step < 3; step += 1) await fireEvent.press(screen.getByTestId('debrief-skip'));
    // Still inside the 1 s hold: the card shows its confirmation, no longer a question.
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Thanks');
    await fireEvent.press(composerSend());
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    const [request] = mockedAsk.mock.calls[0] ?? [];
    expect(request?.mode).toBe('chat');
    expect(request).not.toHaveProperty('episodeId');
  });

  test('once answered, the card leaves and the closing line stays in the chat', async () => {
    seed();
    await render(<Companion />);
    for (let step = 0; step < 3; step += 1) await fireEvent.press(screen.getByTestId('debrief-skip'));
    await act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('debrief-skip')).toBeNull();
    expect(screen.getByText(t('debrief.done'))).toBeTruthy();
  });

  test('an attack ended today is not asked about yet', async () => {
    seedEpisode(USER, new Date(2026, 10, 27, 1, 0), new Date(2026, 10, 27, 6, 0));
    await render(<Companion />);
    expect(screen.queryByTestId('debrief-skip')).toBeNull();
  });
});
