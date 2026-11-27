// "Tell me" in crisis mode, through the crisis screen: the red-flag check first, the companion when it can answer, and
// the attack's notes when it can't.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Speech from 'expo-speech';
import { BackHandler } from 'react-native';

import Crisis from '../../app/crisis';
import { saveMedication } from '../../cabinet/medicationStore';
import type { MedicationInput } from '../../cabinet/medicationStore';
import { askCompanion } from '../../companion/companionClient';
import type { CompanionOutcome } from '../../companion/companionClient';
import type { CompanionResponse, EpisodeDraft } from '../../companion/contract';
import { companionDay } from '../../companion/useCompanion';
import { deleteEpisode, NOTES_MAX_LENGTH, readEpisode, startEpisode, updateEpisode } from '../../episodes/episodeStore';
import * as episodeStore from '../../episodes/episodeStore';
import { translate } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { kvRemove, kvSet } from '../../lib/kv';
import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { READY_PROFILE, resetAuth } from '../../test/authMock';
import { emitRecognition, hear, recognition, settle } from '../../test/dictation';
import { clearLocalDb } from '../../test/localDbTest';
import { ThemeContext } from '../../ui/themeContext';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('expo-keep-awake', () => ({ useKeepAwake: jest.fn() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(),
  useIsFocused: () => true,
}));
const mockNetwork = { state: { isConnected: true, isInternetReachable: true } };
jest.mock('expo-network', () => ({
  useNetworkState: () => mockNetwork.state,
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../companion/companionClient', () => ({
  ...jest.requireActual<typeof import('../../companion/companionClient')>('../../companion/companionClient'),
  askCompanion: jest.fn(),
}));

const t = (key: MessageKey): string => translate('en', key);
const mockedAsk = jest.mocked(askCompanion);
const USER = 'user-1';
const STARTED = new Date('2026-11-26T18:40:00Z');
const NOW = new Date(STARTED.getTime() + 15 * 60 * 1000);
const IBUPROFEN = '00000000-0000-4000-8000-0000000000a1';
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

let episodeId = '';

function answer(patch: Partial<CompanionResponse> = {}): CompanionOutcome {
  return {
    ok: true,
    result: { reply: 'Noted. Check it and confirm when you can.', drafts: [], evidence: [], redFlags: [], intent: 'log_episode', guard: 'ok', replaced: null, ...patch },
  };
}

function draft(): EpisodeDraft {
  return {
    kind: 'episode',
    ref: 'd1',
    episodeId,
    startedAt: null,
    endedAt: null,
    intensity: 6,
    painAreas: [],
    symptoms: ['nausea'],
    triggers: [],
    reliefs: [],
    helped: [],
    didNotHelp: [],
    doses: [{ medicationId: IBUPROFEN, takenAt: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() }],
  };
}

async function open(): Promise<void> {
  await render(
    <ThemeContext.Provider value={{ name: 'day', reduceMotion: false, forceDim: jest.fn() }}>
      <Crisis />
    </ThemeContext.Provider>,
  );
}

/** Holds "Tell me", says `text` and lets go; then lets the request settle. */
async function tell(text: string): Promise<void> {
  await fireEvent(screen.getByRole('button', { name: t('crisis.tell') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
  await settle();
  await fireEvent(screen.getByRole('button', { name: t('crisis.listening.held') }), 'responderRelease', { nativeEvent: { pageY: 700 } });
  await act(() => {
    hear(text);
  });
  await settle();
}

function updateOps(): number {
  return listOutbox(USER).filter((op) => op.kind === 'update_episode').length;
}

function chatInputs(): { role: string; input: string; mode: string }[] {
  return localDb().getAllSync('SELECT role, input, mode FROM chat_messages ORDER BY id;');
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  mockNetwork.state = { isConnected: true, isInternetReachable: true };
  for (const kind of ['companion', 'dictation']) kvRemove(`companion.quota.${kind}.${USER}.${companionDay()}`);
  saveMedication(USER, IBUPROFEN, ACUTE);
  episodeId = startEpisode(USER, STARTED);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: episodeId });
});

afterEach(() => {
  jest.useRealTimers();
  // The BackHandler and store spies, even when a test fails before restoring them itself.
  jest.restoreAllMocks();
});

test('"Tell me" sits in the dock next to "It’s over", with its hint', async () => {
  await open();
  expect(screen.getByRole('button', { name: t('crisis.tell') })).toHaveProp('accessibilityHint', t('crisis.tell.hint'));
  expect(screen.getByRole('button', { name: t('crisis.over') })).toBeOnTheScreen();
});

test('while held, the listening line shows and "It’s over" steps aside', async () => {
  await open();
  await fireEvent(screen.getByRole('button', { name: t('crisis.tell') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
  await settle();
  expect(screen.getByText(t('crisis.listening'))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.listening.release'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('crisis.over') })).toBeNull();
});

test('a transcript with a red-flag phrase opens urgent care once and sends nothing', async () => {
  await open();
  await tell('the worst headache of my life, it came on all at once');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/urgent-care');
  expect(mockedAsk).not.toHaveBeenCalled();
  expect(readEpisode(USER, episodeId)?.notes).toBeNull();
});

test('a red flag only the server caught opens urgent care once, keeps crisis mode open, and shows the after line', async () => {
  // No keyword on the phone matches this one; Jev on the server does.
  mockedAsk.mockResolvedValueOnce(answer({ reply: null, redFlags: ['weakness'], intent: 'other' }));
  await open();
  await tell('my left hand has gone strange and heavy');

  expect(mockedAsk).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/urgent-care');
  expect(router.back).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  // Back from urgent care, crisis mode is where it was, with the after line in place of a reply.
  expect(screen.getByText(t('companion.redflag.after'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('crisis.over') })).toBeOnTheScreen();
  expect(localDb().getAllSync('SELECT role, status, template FROM chat_messages ORDER BY id;')).toEqual([
    { role: 'user', status: 'red_flag', template: null },
    { role: 'assistant', status: 'red_flag', template: 'redflag_after' },
  ]);
  expect(readEpisode(USER, episodeId)?.notes).toBeNull();
});

test('a normal transcript sends crisis mode, voice input and the episode id; the reply reads aloud and the draft takes the dock', async () => {
  mockedAsk.mockResolvedValueOnce(answer({ drafts: [draft()] }));
  await open();
  await tell('I took an ibuprofen ten minutes ago, I feel sick');

  expect(mockedAsk).toHaveBeenCalledTimes(1);
  expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ mode: 'crisis', input: 'voice', episodeId }));
  expect(chatInputs()).toEqual([
    { role: 'user', input: 'voice', mode: 'crisis' },
    { role: 'assistant', input: 'voice', mode: 'crisis' },
  ]);
  expect(screen.getByText('Noted. Check it and confirm when you can.')).toBeOnTheScreen();
  expect(screen.getByText(t('draft.episode.title'))).toBeOnTheScreen();
  // The dock is the draft's now.
  expect(screen.queryByRole('button', { name: t('crisis.tell') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('crisis.over') })).toBeNull();
  expect(screen.getAllByRole('button', { name: t('common.confirm') })).toHaveLength(1);

  await act(async () => {
    await Promise.resolve();
  });
  await fireEvent.press(screen.getByRole('togglebutton', { name: t('crisis.read_aloud') }));
  expect(Speech.speak).toHaveBeenCalledWith('Noted. Check it and confirm when you can.', expect.anything());

  await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
  expect(readEpisode(USER, episodeId)).toEqual(expect.objectContaining({ intensity: 6, symptoms: ['nausea'] }));
  expect(localDb().getAllSync('SELECT medication_id, episode_id FROM doses;')).toEqual([{ medication_id: IBUPROFEN, episode_id: episodeId }]);
  expect(screen.getByRole('button', { name: t('crisis.tell') })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('crisis.over') })).toBeOnTheScreen();
});

test('Android back with a draft waiting puts it aside and keeps crisis mode open', async () => {
  mockedAsk.mockResolvedValueOnce(answer({ drafts: [draft()] }));
  const listeners: (() => boolean | null | undefined)[] = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(() => listener({} as never));
    return { remove: jest.fn() };
  });
  await open();
  await tell('I took an ibuprofen');
  await act(() => {
    for (const listener of listeners) listener();
  });
  expect(screen.queryByText(t('draft.episode.title'))).toBeNull();
  expect(screen.getByRole('button', { name: t('crisis.tell') })).toBeOnTheScreen();
  expect(router.back).not.toHaveBeenCalled();
});

test('offline, the transcript is appended to the notes and the saved-note line shows', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  updateEpisode(USER, episodeId, { notes: 'Started at work.' });
  await open();
  await tell('left temple, nausea');
  expect(mockedAsk).not.toHaveBeenCalled();
  expect(readEpisode(USER, episodeId)?.notes).toBe('Started at work.\nleft temple, nausea');
  expect(screen.getByText(t('crisis.tell.saved_note'))).toBeOnTheScreen();
});

test('with dictation used up today it does the same and sends nothing', async () => {
  kvSet(`companion.quota.dictation.${USER}.${companionDay()}`, '20');
  await open();
  await tell('left temple, nausea');
  expect(mockedAsk).not.toHaveBeenCalled();
  expect(readEpisode(USER, episodeId)?.notes).toBe('left temple, nausea');
  expect(screen.getByText(t('crisis.tell.saved_note'))).toBeOnTheScreen();
});

test('a request refused on the way (the companion quota) also lands in the notes', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error: 'over_quota', quota: 'companion', limit: 40 });
  await open();
  await tell('left temple, nausea');
  expect(mockedAsk).toHaveBeenCalledTimes(1);
  expect(readEpisode(USER, episodeId)?.notes).toBe('left temple, nausea');
  expect(screen.getByText(t('crisis.tell.saved_note'))).toBeOnTheScreen();
});

test('notes of 1,990 characters plus a 50-character transcript are saved at 2,000 characters exactly', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  updateEpisode(USER, episodeId, { notes: 'n'.repeat(1990) });
  await open();
  await tell('t'.repeat(50));
  const notes = readEpisode(USER, episodeId)?.notes ?? '';
  expect(notes).toHaveLength(NOTES_MAX_LENGTH);
  expect(notes).toBe(`${'n'.repeat(1990)}\n${'t'.repeat(9)}`);
  // Honest about the cut: only the start was kept.
  expect(screen.getByText(t('crisis.tell.saved_cut'))).toBeOnTheScreen();
  expect(screen.queryByText(t('crisis.tell.saved_note'))).toBeNull();
});

test('notes already at 2,000 show notes_full and queue no update_episode', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  updateEpisode(USER, episodeId, { notes: 'n'.repeat(NOTES_MAX_LENGTH) });
  const before = updateOps();
  await open();
  await tell('left temple, nausea');
  expect(updateOps()).toBe(before);
  expect(readEpisode(USER, episodeId)?.notes).toHaveLength(NOTES_MAX_LENGTH);
  expect(screen.getByText(t('crisis.tell.notes_full'))).toBeOnTheScreen();
});

test('a cut never splits an emoji in two', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  updateEpisode(USER, episodeId, { notes: 'n'.repeat(1997) });
  await open();
  await tell('a😣b');
  // 1997 + newline leaves two units: "a" fits, the emoji's pair does not.
  expect(readEpisode(USER, episodeId)?.notes).toBe(`${'n'.repeat(1997)}\na`);
  expect(screen.getByText(t('crisis.tell.saved_cut'))).toBeOnTheScreen();
});

test('a red flag on the offline notes path opens urgent care once and saves nothing', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  updateEpisode(USER, episodeId, { notes: 'Started at work.' });
  const before = updateOps();
  await open();
  await tell('the worst headache of my life, it came on all at once');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/urgent-care');
  expect(readEpisode(USER, episodeId)?.notes).toBe('Started at work.');
  expect(updateOps()).toBe(before);
  expect(screen.queryByText(t('crisis.tell.saved_note'))).toBeNull();
});

test('on the notes path, the held line says the words go to the notes instead of promising a Confirm', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  await open();
  await fireEvent(screen.getByRole('button', { name: t('crisis.tell') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
  await settle();
  expect(screen.getByText(t('crisis.listening.release_notes'))).toBeOnTheScreen();
  expect(screen.queryByText(t('crisis.listening.release'))).toBeNull();
});

test('a store refusal inside the notes write shows the generic error, never notes_full, and nothing throws', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  const spy = jest.spyOn(episodeStore, 'updateEpisode').mockImplementation(() => {
    throw new RangeError('refused');
  });
  await open();
  await tell('left temple, nausea');
  expect(spy).toHaveBeenCalled();
  expect(screen.getByText(t('error.generic'))).toBeOnTheScreen();
  expect(screen.queryByText(t('crisis.tell.notes_full'))).toBeNull();
});

test('an attack deleted while the request was out says the words could not be saved', async () => {
  let fail: (outcome: CompanionOutcome) => void = () => undefined;
  mockedAsk.mockReturnValueOnce(
    new Promise((resolve) => {
      fail = resolve;
    }),
  );
  await open();
  await tell('left temple, nausea');
  deleteEpisode(USER, episodeId);
  await act(async () => {
    fail({ ok: false, error: 'network' });
    await Promise.resolve();
  });
  await settle();
  expect(screen.getByText(t('crisis.tell.gone'))).toBeOnTheScreen();
});

test('a send refused on the way and saved to the notes is marked in the chat, so Retry is not offered', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error: 'network' });
  await open();
  await tell('left temple, nausea');
  expect(readEpisode(USER, episodeId)?.notes).toBe('left temple, nausea');
  expect(localDb().getAllSync('SELECT role, status FROM chat_messages;')).toEqual([{ role: 'user', status: 'noted' }]);
});

test('"Read aloud" and "Not now" are crisis-sized, 56 pt', async () => {
  mockedAsk.mockResolvedValueOnce(answer({ drafts: [draft()] }));
  await open();
  await tell('I took an ibuprofen');
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole('togglebutton', { name: t('crisis.read_aloud') })).toHaveStyle({ width: 56, height: 56 });
  expect(screen.getByRole('button', { name: t('common.not_now') })).toHaveStyle({ minHeight: 56 });
});

test('with no recognizer, "Tell me" is absent and "It’s over" keeps the whole dock', async () => {
  recognition.isRecognitionAvailable.mockReturnValue(false);
  await open();
  expect(screen.queryByRole('button', { name: t('crisis.tell') })).toBeNull();
  expect(screen.getByTestId('crisis-over').parent?.parent).toHaveStyle({ flex: 1 });
  recognition.isRecognitionAvailable.mockReturnValue(true);
});

test('with the AI off, "Tell me" is absent and the taps line shows', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await open();
  expect(screen.queryByRole('button', { name: t('crisis.tell') })).toBeNull();
  expect(screen.getByText(t('crisis.ai_off'))).toBeOnTheScreen();
});

test('a dictation problem shows its line in crisis mode', async () => {
  await open();
  await fireEvent(screen.getByRole('button', { name: t('crisis.tell') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
  await settle();
  await fireEvent(screen.getByRole('button', { name: t('crisis.listening.held') }), 'responderRelease', { nativeEvent: { pageY: 700 } });
  // The recognizer ends with nothing heard.
  await act(() => {
    emitRecognition('end');
  });
  expect(screen.getByText(t('voice.no_match'))).toBeOnTheScreen();
  expect(mockedAsk).not.toHaveBeenCalled();
});
