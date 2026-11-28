import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import Companion from '../app/(tabs)/companion';
import { logDose } from '../cabinet/doseStore';
import { saveMedication } from '../cabinet/medicationStore';
import type { MedicationInput } from '../cabinet/medicationStore';
import { appendMessage } from '../companion/chatStore';
import { readOpenEpisode, startEpisode } from '../episodes/episodeStore';
import type { ChatMessage, ChatPayload } from '../companion/chatStore';
import { askCompanion } from '../companion/companionClient';
import type { CompanionOutcome } from '../companion/companionClient';
import type { EpisodeDraft } from '../companion/contract';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { formatClock } from '../i18n/format';
import { kvRemove, kvSet } from '../lib/kv';
import { localDate } from '../lib/localDate';
import { listOutbox } from '../lib/outbox/outbox';
import { resetAuth } from '../test/authMock';
import { hear, recognition, settle } from '../test/dictation';
import { seedEpisode } from '../test/episodeSeed';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
const mockParams: { value: { debrief?: string } } = { value: {} };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams.value,
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
const mockNetwork = { state: { isConnected: true, isInternetReachable: true } };
jest.mock('expo-network', () => ({
  useNetworkState: () => mockNetwork.state,
  addNetworkStateListener: () => ({ remove: () => undefined }),
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../companion/companionClient', () => ({
  ...jest.requireActual<typeof import('../companion/companionClient')>('../companion/companionClient'),
  askCompanion: jest.fn(),
}));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const mockedAsk = jest.mocked(askCompanion);
const USER = 'user-1';
const NOW = new Date(2026, 10, 27, 16, 20);
const IBUPROFEN = '00000000-0000-4000-8000-0000000000a1';

const MEDICATION: MedicationInput = {
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

const EMPTY_PAYLOAD: ChatPayload = { drafts: [], evidence: [], guard: 'ok', replaced: null, confirmed: {} };

function seed(role: ChatMessage['role'], text: string, patch: Partial<Omit<ChatMessage, 'id'>> = {}): number {
  return appendMessage(USER, {
    role,
    input: 'text',
    text,
    template: null,
    createdAt: NOW.getTime(),
    status: 'answered',
    mode: 'chat',
    payload: role === 'assistant' ? EMPTY_PAYLOAD : null,
    ...patch,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  mockNetwork.state = { isConnected: true, isInternetReachable: true };
  mockParams.value = {};
  for (const kind of ['companion', 'dictation']) kvRemove(`companion.quota.${kind}.${USER}.${localDate(NOW)}`);
});

afterEach(() => {
  jest.useRealTimers();
});

test('the empty state offers the three suggestions, and one sends its own text', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Here.', drafts: [], evidence: [], redFlags: [], intent: 'data_question', guard: 'ok', replaced: null } });
  await render(<Companion />);
  for (const key of ['companion.suggest.common', 'companion.suggest.log_sleep', 'companion.suggest.med_days'] as const) {
    expect(screen.getByRole('button', { name: t(key) })).toBeTruthy();
  }
  await fireEvent.press(screen.getByRole('button', { name: t('companion.suggest.common') }));
  expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ messages: [{ role: 'user', text: t('companion.suggest.common') }] }));
  expect(await screen.findByText('Here.')).toBeTruthy();
});

test('an episodes evidence chip names the count and opens a sheet with those attacks', async () => {
  const ids = [1, 2, 3].map((day) => seedEpisode(USER, new Date(2026, 10, 20 + day, 9), new Date(2026, 10, 20 + day, 12)));
  seedEpisode(USER, new Date(2026, 10, 10, 9), new Date(2026, 10, 10, 12));
  seed('user', 'How many attacks this week?');
  seed('assistant', 'You logged three.', {
    payload: { ...EMPTY_PAYLOAD, evidence: [{ ref: 'r1', source: 'episodes', count: 3, of: null, episodeIds: ids, doseIds: [] }] },
  });
  await render(<Companion />);

  await fireEvent.press(screen.getByRole('button', { name: '3 attacks' }));
  expect(screen.getByLabelText(t('evidence.sheet.label'))).toBeTruthy();
  expect(screen.getAllByTestId(/^episode-row-/)).toHaveLength(3);

  await fireEvent.press(screen.getByTestId(`episode-row-${ids[0] ?? ''}`));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/episode/[id]', params: { id: ids[0] } });
});

test('an episode draft says what the user did not say, and Confirm saves it', async () => {
  const draft: EpisodeDraft = {
    kind: 'episode',
    ref: 'd1',
    episodeId: null,
    startedAt: new Date(2026, 10, 26, 16, 0).toISOString(),
    endedAt: new Date(2026, 10, 26, 21, 0).toISOString(),
    intensity: 7,
    painAreas: [],
    symptoms: [],
    triggers: [],
    reliefs: [],
    helped: ['sleep'],
    didNotHelp: [],
    doses: [],
  };
  seed('user', 'Yesterday I had a strong one.');
  seed('assistant', 'I put it together like this.', { payload: { ...EMPTY_PAYLOAD, drafts: [draft] } });
  await render(<Companion />);

  expect(screen.getByText(t('draft.episode.title'))).toBeTruthy();
  expect(screen.getByText(t('draft.sub'))).toBeTruthy();
  expect(screen.getByText(t('draft.v.yesterday_at', { time: formatClock(new Date(2026, 10, 26, 16, 0), 'en') }))).toBeTruthy();
  expect(screen.getByText(t('draft.k.trigger'))).toBeTruthy();
  expect(screen.getByText(t('draft.v.unsaid'))).toBeTruthy();
  expect(screen.getByText(t('condition.reliefs.sleep'))).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
  expect(listOutbox(USER).map((op) => op.kind)).toEqual(['log_episode', 'update_episode']);
  expect(await screen.findByRole('button', { name: t('common.done') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('common.confirm') })).toBeNull();
});

test('a replaced dose answer shows the dose template, the facts from the cabinet and the notice', async () => {
  saveMedication(USER, IBUPROFEN, MEDICATION);
  const taken = new Date(2026, 10, 27, 15, 55);
  logDose(USER, { medicationId: IBUPROFEN, takenAt: taken, episodeId: null });
  seed('user', 'Can I take another one?', { status: 'replaced' });
  seed('assistant', '', { status: 'replaced', payload: { ...EMPTY_PAYLOAD, guard: 'replaced', replaced: 'dose_advice' } });
  await render(<Companion />);

  expect(screen.getByText(t('companion.safe.dose'))).toBeTruthy();
  expect(screen.getByText(t('companion.safe.facts', { med: 'Ibuprofen 400 mg', time: formatClock(taken, 'en'), hours: 8 }))).toBeTruthy();
  expect(screen.getByText(t('companion.safe.notice'))).toBeTruthy();
});

test('a degraded reply carries the urgent-care footer', async () => {
  seed('user', 'How was my week?');
  seed('assistant', 'You logged two attacks.', { payload: { ...EMPTY_PAYLOAD, guard: 'degraded' } });
  await render(<Companion />);
  expect(screen.getByText(t('companion.footer.degraded'))).toBeTruthy();
});

test('offline shows the offline note and disables the input', async () => {
  mockNetwork.state = { isConnected: false, isInternetReachable: false };
  await render(<Companion />);
  expect(screen.getByText(t('companion.offline.title'))).toBeTruthy();
  expect(screen.getByLabelText(t('companion.input.label'))).toBeDisabled();
});

test('over the quota names the limit the server reported and closes the input', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error: 'over_quota', quota: 'companion', limit: 40 });
  await render(<Companion />);
  await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
  expect(await screen.findByText('You’ve used today’s 40 messages')).toBeTruthy();
  expect(screen.getByLabelText(t('companion.input.label'))).toBeDisabled();
  expect(screen.getByPlaceholderText(t('companion.input.quota'))).toBeTruthy();
});

test('the typing line appears only once 300 ms pass without a reply', async () => {
  let resolve: (outcome: CompanionOutcome) => void = () => undefined;
  mockedAsk.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await render(<Companion />);
  await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
  await act(() => {
    jest.advanceTimersByTime(299);
  });
  expect(screen.queryByText(t('companion.typing'))).toBeNull();
  await act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByText(t('companion.typing'))).toBeTruthy();

  await act(async () => {
    resolve({ ok: true, result: { reply: 'Hi.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await Promise.resolve();
  });
  expect(screen.queryByText(t('companion.typing'))).toBeNull();
});

test('the topbar button starts an attack and opens crisis mode, or resumes the open one', async () => {
  await render(<Companion />);
  const button = screen.getByRole('button', { name: t('today.start') });
  expect(screen.getByText(t('today.start.short'))).toBeTruthy();
  await fireEvent.press(button);
  const opened = readOpenEpisode(USER);
  expect(opened).not.toBeNull();
  expect(router.push).toHaveBeenCalledWith({ pathname: '/crisis', params: { id: opened?.id } });
});

test('with an attack open, the topbar button resumes it instead of starting another', async () => {
  const open = startEpisode(USER, new Date(2026, 10, 27, 15, 0));
  await render(<Companion />);
  await fireEvent.press(screen.getByRole('button', { name: t('today.resume') }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/crisis', params: { id: open } });
  expect(listOutbox(USER).filter((op) => op.kind === 'log_episode')).toHaveLength(1);
});

test('a replaced dose answer still shows the draft the server kept, and Confirm saves it', async () => {
  saveMedication(USER, IBUPROFEN, MEDICATION);
  seed('user', 'I took an ibuprofen, can I take another?', { status: 'replaced' });
  seed('assistant', '', {
    status: 'replaced',
    payload: {
      ...EMPTY_PAYLOAD,
      guard: 'replaced',
      replaced: 'dose_advice',
      drafts: [{ kind: 'dose', ref: 'd1', medicationId: IBUPROFEN, takenAt: new Date(2026, 10, 27, 15, 55).toISOString(), episodeId: null }],
    },
  });
  await render(<Companion />);
  expect(screen.getByText(t('companion.safe.dose'))).toBeTruthy();
  expect(screen.getByText(t('draft.dose.title'))).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
  expect(listOutbox(USER).map((op) => op.kind)).toEqual(['save_medication', 'log_dose']);
});

test.each([
  ['diagnosis', 'companion.safe.diagnosis'],
  ['ungrounded_number', 'companion.safe.numbers'],
  ['prediction', 'companion.safe.numbers'],
  ['red_flag_dismissal', 'companion.safe.urgent'],
  ['refusal', 'companion.refused'],
] as const)('a reply replaced for %s shows its template and the general notice', async (reason, key) => {
  seed('user', 'A question', { status: 'replaced' });
  seed('assistant', '', { status: 'replaced', payload: { ...EMPTY_PAYLOAD, guard: 'replaced', replaced: reason } });
  await render(<Companion />);
  expect(screen.getByText(t(key))).toBeTruthy();
  expect(screen.getByText(t('companion.safe.notice.general'))).toBeTruthy();
  expect(screen.queryByText(t('companion.safe.notice'))).toBeNull();
});

test('the line after a server red flag renders in the UI language', async () => {
  seed('user', 'My arm feels odd', { status: 'red_flag' });
  seed('assistant', '', { status: 'red_flag', template: 'redflag_after', payload: null });
  await render(<Companion />);
  expect(screen.getByText(t('companion.redflag.after'))).toBeTruthy();
});

test('a red flag typed on the phone opens urgent care and sends nothing', async () => {
  await render(<Companion />);
  await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'This is the worst headache of my life');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
  expect(router.push).toHaveBeenCalledWith('/urgent-care');
  expect(mockedAsk).not.toHaveBeenCalled();
  expect(screen.getByText('This is the worst headache of my life')).toBeTruthy();
});

test('unavailable shows the down note with the manual dose and check-in', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error: 'unavailable' });
  await render(<Companion />);
  await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
  expect(await screen.findByText(t('companion.down.title'))).toBeTruthy();
  expect(screen.getByPlaceholderText(t('companion.input.down'))).toBeTruthy();
  expect(screen.getByText(t('companion.unsent'))).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: t('companion.manual.dose') }));
  expect(router.push).toHaveBeenCalledWith('/cabinet');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.manual.checkin') }));
  // One navigation per visit: the second press waits for the screen to be focused again.
  expect(router.push).toHaveBeenCalledTimes(1);
});

test('over the quota, Retry is disabled', async () => {
  mockedAsk.mockResolvedValueOnce({ ok: false, error: 'over_quota', quota: 'companion', limit: 40 });
  await render(<Companion />);
  await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Hello');
  await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
  expect(await screen.findByRole('button', { name: t('common.retry') })).toBeDisabled();
});

test('a message "Tell me" saved to an attack’s notes says so and offers no Retry', async () => {
  seed('user', 'left temple, nausea', { status: 'noted', input: 'voice', mode: 'crisis' });
  await render(<Companion />);
  expect(screen.getByText(t('companion.in_notes'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('common.retry') })).toBeNull();
});

describe('the mic', () => {
  async function dictate(text: string): Promise<void> {
    await fireEvent(screen.getByRole('button', { name: t('companion.mic') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
    await settle();
    await fireEvent(screen.getByRole('button', { name: t('crisis.listening.held') }), 'responderRelease', { nativeEvent: { pageY: 700 } });
    await act(() => {
      hear(text);
    });
  }

  test('a transcript fills the input and waits for Send, which spends it as voice', async () => {
    mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await render(<Companion />);
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Today');
    await dictate('I slept five hours');

    expect(screen.getByLabelText(t('companion.input.label'))).toHaveProp('value', 'Today I slept five hours');
    expect(mockedAsk).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
    expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ input: 'voice', messages: [{ role: 'user', text: 'Today I slept five hours' }] }));
  });

  test('a dictated red flag opens urgent care at once, once, and nothing reaches the companion', async () => {
    await render(<Companion />);
    await dictate('the worst headache of my life, it came on all at once');
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/urgent-care');
    expect(mockedAsk).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t('companion.input.label'))).toHaveProp('value', '');
  });

  test('typed text alone is sent as text', async () => {
    mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await render(<Companion />);
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Hello');
    await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
    expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ input: 'text' }));
  });

  test('a transcript cleared by hand leaves a typed message', async () => {
    mockedAsk.mockResolvedValueOnce({ ok: true, result: { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null } });
    await render(<Companion />);
    await dictate('I slept five hours');
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), '');
    await fireEvent.changeText(screen.getByLabelText(t('companion.input.label')), 'Typed instead');
    await fireEvent.press(screen.getByRole('button', { name: t('companion.send') }));
    expect(mockedAsk).toHaveBeenCalledWith(expect.objectContaining({ input: 'text' }));
  });

  test('with dictation used up today, the mic is disabled with the quota hint, and typing still works', async () => {
    kvSet(`companion.quota.dictation.${USER}.${localDate(NOW)}`, '20');
    await render(<Companion />);
    const mic = screen.getByRole('button', { name: t('companion.mic') });
    expect(mic).toBeDisabled();
    expect(mic).toHaveProp('accessibilityHint', t('voice.quota'));
    // Seen too, not only heard by a screen reader.
    expect(screen.getByText(t('voice.quota'))).toBeOnTheScreen();
    await fireEvent(mic, 'responderGrant', { nativeEvent: { pageY: 700 } });
    await settle();
    expect(recognition.start).not.toHaveBeenCalled();
    expect(screen.getByLabelText(t('companion.input.label'))).not.toBeDisabled();
  });

  test('a denied microphone says how to allow it', async () => {
    recognition.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' });
    await render(<Companion />);
    await fireEvent(screen.getByRole('button', { name: t('companion.mic') }), 'responderGrant', { nativeEvent: { pageY: 700 } });
    await settle();
    expect(screen.getByText(t('voice.denied'))).toBeOnTheScreen();
  });
});

test('Today’s debrief row (an id in the route) asks about that attack even at 01:30', async () => {
  jest.setSystemTime(new Date(2026, 10, 27, 1, 30));
  const id = seedEpisode(USER, new Date(2026, 10, 26, 17, 0), new Date(2026, 10, 26, 18, 40));
  const greeting = t('debrief.q.helped.yesterday', { duration: '1 h 40 min' });
  const before = await render(<Companion />);
  // Without the row's id, nothing is asked before the morning.
  expect(screen.queryByText(greeting)).not.toBeOnTheScreen();
  await before.unmount();

  mockParams.value = { debrief: id };
  await render(<Companion />);
  expect(screen.getByText(greeting)).toBeOnTheScreen();
});
