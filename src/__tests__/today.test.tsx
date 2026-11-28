import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import Today from '../app/(tabs)/today';
import { logDose } from '../cabinet/doseStore';
import { saveMedication } from '../cabinet/medicationStore';
import type { MedicationInput } from '../cabinet/medicationStore';
import { saveCheckin } from '../checkin/checkinStore';
import { endEpisode, readOpenEpisode, startEpisode } from '../episodes/episodeStore';
import { formatClock } from '../i18n/format';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { localDate } from '../lib/localDate';
import { listOutbox } from '../lib/outbox/outbox';
import { READY_PROFILE, resetAuth } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// A screen is focused once, on mount; `mockFocus.again()` focuses it again, as coming back to it does.
const mockFocus: { effects: Set<() => void>; again: () => void } = {
  effects: new Set(),
  again: () => {
    for (const effect of mockFocus.effects) effect();
  },
};
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    mockFocus.effects.add(effect);
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
jest.mock('../signals/signalRepository', () => ({ fetchTodayPressure: jest.fn(() => Promise.resolve(null)), readCachedPressure: () => null }));
const mockSync = { pending: 0, failed: 0, syncing: false, retry: jest.fn() };
jest.mock('../lib/sync/SyncProvider', () => ({ useSyncState: () => mockSync }));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
// Local wall-clock times, as the screen shows them.
const NOW = new Date(2026, 10, 26, 14, 20);
const TRIPTAN = '00000000-0000-4000-8000-0000000000b1';

const SUMATRIPTAN: MedicationInput = {
  name: 'Sumatriptan',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'triptan',
  doseText: null,
  minIntervalHours: null,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
};

const SECTION_TITLES = new Set([t('today.signals.title'), t('today.med.title'), t('today.checkin.title')]);

function sectionOrder(): string[] {
  return screen
    .getAllByRole('header')
    .map((node) => String(node.props.children))
    .filter((name) => SECTION_TITLES.has(name));
}

function textIndex(text: string): number {
  return JSON.stringify(screen.toJSON()).indexOf(text);
}

function doCheckin(): void {
  saveCheckin('user-1', localDate(NOW), { sleepBand: '7_8', stress: 'low' });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  mockSync.pending = 0;
  mockSync.failed = 0;
});

afterEach(() => {
  jest.useRealTimers();
});

test('the first day says so, and each section says what fills it', async () => {
  resetAuth({ profile: { ...READY_PROFILE, onboardingCompletedAt: NOW.toISOString() } });
  await render(<Today />);

  expect(screen.getByRole('header', { name: t('today.status.first') })).toBeOnTheScreen();
  expect(screen.getByText(t('today.status.first_sub'))).toBeOnTheScreen();
  expect(screen.getByText(t('today.signals.empty'))).toBeOnTheScreen();
  expect(screen.getByText(t('today.med.empty'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('today.start') })).toBeOnTheScreen();
  expect(screen.getByText(t('today.note.first'))).toBeOnTheScreen();
});

test('an open attack shows its running time, this attack and the way back to it', async () => {
  const started = new Date(2026, 10, 26, 9, 0);
  const id = startEpisode('user-1', started);
  await render(<Today />);

  expect(screen.getByRole('header', { name: t('today.status.running') })).toBeOnTheScreen();
  expect(screen.getByText(t('today.status.since', { time: formatClock(started, 'en'), elapsed: '5 h 20 min' }))).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('today.attack.title') })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('today.start') })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('today.resume') }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/crisis', params: { id } });
  // No second attack was started.
  expect(listOutbox('user-1').filter((op) => op.kind === 'log_episode')).toHaveLength(1);
});

test('at 12 hours Today asks whether the attack is over, and “Yes” ends it', async () => {
  startEpisode('user-1', new Date(NOW.getTime() - 12 * 60 * 60 * 1000));
  await render(<Today />);

  expect(screen.getByText(t('crisis.over.title'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.confirm') }));

  expect(readOpenEpisode('user-1')).toBeNull();
  expect(listOutbox('user-1').map((op) => op.kind)).toEqual(['log_episode', 'end_episode']);
  expect(screen.queryByText(t('crisis.over.title'))).not.toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('today.status.none') })).toBeOnTheScreen();
});

test('“Not yet” hides the question until the next 12 hours', async () => {
  startEpisode('user-1', new Date(NOW.getTime() - 13 * 60 * 60 * 1000));
  const first = await render(<Today />);

  await fireEvent.press(screen.getByRole('button', { name: t('crisis.over.not_yet') }));
  expect(screen.queryByText(t('crisis.over.title'))).not.toBeOnTheScreen();
  expect(readOpenEpisode('user-1')).not.toBeNull();

  // Still hidden on the next visit within the same 12 hours.
  await first.unmount();
  await render(<Today />);
  expect(screen.queryByText(t('crisis.over.title'))).not.toBeOnTheScreen();
});

test('before 12 hours there is no question', async () => {
  startEpisode('user-1', new Date(NOW.getTime() - 11 * 60 * 60 * 1000));
  await render(<Today />);
  expect(screen.queryByText(t('crisis.over.title'))).not.toBeOnTheScreen();
});

test('8 triptan days put the medication first, with the warning ahead of the month’s count', async () => {
  saveMedication('user-1', TRIPTAN, SUMATRIPTAN);
  for (let day = 1; day <= 8; day += 1) {
    logDose('user-1', { medicationId: TRIPTAN, takenAt: new Date(2026, 10, day, 12, 0), episodeId: null });
  }
  doCheckin();
  await render(<Today />);

  expect(sectionOrder()).toEqual([t('today.med.title'), t('today.signals.title'), t('today.checkin.title')]);
  const warning = t('overuse.warn.title', { class: t('med.class.triptan'), used: 8, limit: 10 });
  expect(screen.getByText(warning)).toBeOnTheScreen();
  expect(textIndex(warning)).toBeLessThan(textIndex(t('today.med.month')));
  expect(screen.getByText(t('today.med.days', { used: 8, limit: 10 }))).toBeOnTheScreen();
});

test('a pending check-in comes first; once done, the base order returns', async () => {
  saveMedication('user-1', TRIPTAN, SUMATRIPTAN);
  const pending = await render(<Today />);
  expect(sectionOrder()).toEqual([t('today.checkin.title'), t('today.signals.title'), t('today.med.title')]);
  await pending.unmount();

  doCheckin();
  await render(<Today />);
  expect(sectionOrder()).toEqual([t('today.signals.title'), t('today.med.title'), t('today.checkin.title')]);
});

test('the “not overdoing pain relievers” priority puts the medication first', async () => {
  resetAuth({ profile: { ...READY_PROFILE, priority: 'overuse' } });
  doCheckin();
  await render(<Today />);
  expect(sectionOrder()).toEqual([t('today.med.title'), t('today.signals.title'), t('today.checkin.title')]);
});

test('with 2 operations pending, the sync line appears after 600 ms', async () => {
  mockSync.pending = 2;
  await render(<Today />);
  const line = t('sync.pending.line', { status: t('sync.pending'), count: t('sync.pending.count.other', { n: 2 }) });
  expect(screen.queryByText(line)).not.toBeOnTheScreen();

  await act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(screen.getByText(line)).toBeOnTheScreen();
});

test('“Start an attack” starts one on the phone and opens crisis mode on it', async () => {
  await render(<Today />);
  await fireEvent.press(screen.getByRole('button', { name: t('today.start') }));

  const open = readOpenEpisode('user-1');
  expect(open).not.toBeNull();
  expect(router.push).toHaveBeenCalledWith({ pathname: '/crisis', params: { id: open?.id } });
});

test('a double tap on “Start an attack” opens crisis mode once; back on Today, it opens again', async () => {
  await render(<Today />);
  const button = screen.getByRole('button', { name: t('today.start') });
  // The second tap lands on the same button, by then offering to resume the attack the first one started.
  await fireEvent.press(button);
  await fireEvent.press(screen.getByRole('button', { name: t('today.resume') }));
  expect(router.push).toHaveBeenCalledTimes(1);

  await act(() => {
    mockFocus.again();
  });
  await fireEvent.press(screen.getByRole('button', { name: t('today.resume') }));
  expect(router.push).toHaveBeenCalledTimes(2);
});

test('after an attack ended today, the status says when', async () => {
  const id = startEpisode('user-1', new Date(2026, 10, 26, 8, 0));
  const ended = new Date(2026, 10, 26, 11, 5);
  endEpisode('user-1', id, ended);
  await render(<Today />);

  expect(screen.getByRole('header', { name: t('today.status.none') })).toBeOnTheScreen();
  expect(screen.getByText(t('today.status.last_today', { time: formatClock(ended, 'en') }))).toBeOnTheScreen();
});

test('an attack that ended yesterday or days ago is said that way', async () => {
  const yesterday = startEpisode('user-1', new Date(2026, 10, 25, 17, 0));
  endEpisode('user-1', yesterday, new Date(2026, 10, 25, 18, 40));
  const view = await render(<Today />);
  expect(screen.getByText(t('today.status.last', { time: formatClock(new Date(2026, 10, 25, 18, 40), 'en') }))).toBeOnTheScreen();
  await view.unmount();

  clearLocalDb();
  const older = startEpisode('user-1', new Date(2026, 10, 22, 17, 0));
  endEpisode('user-1', older, new Date(2026, 10, 22, 19, 0));
  await render(<Today />);
  expect(screen.getByText(t('today.status.last_days.other', { n: 4 }))).toBeOnTheScreen();
});

test('the date turns over at midnight without leaving the screen', async () => {
  jest.setSystemTime(new Date(2026, 10, 26, 23, 59, 30));
  await render(<Today />);
  const format = (date: Date): string => new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  expect(screen.getByText(format(new Date(2026, 10, 26)))).toBeOnTheScreen();

  await act(() => {
    jest.advanceTimersByTime(60 * 1000);
  });
  expect(screen.getByText(format(new Date(2026, 10, 27)))).toBeOnTheScreen();
});

test('with the AI off, Today says where to turn it on', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await render(<Today />);
  expect(screen.getByText(t('today.summary.ai_off'))).toBeOnTheScreen();
  expect(screen.queryByText(t('consent.paused'))).not.toBeOnTheScreen();
});

test('with the AI on but a newer AI text unanswered, Today says the AI is paused and opens that screen', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  await render(<Today />);
  expect(screen.getByText(t('consent.paused'))).toBeOnTheScreen();
  expect(screen.queryByText(t('today.summary.ai_off'))).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('today-ai-reconsent'));
  const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
  expect(router.push).toHaveBeenCalledWith('/ai-consent');
});

test('with the AI on and answered, Today shows neither line', async () => {
  await render(<Today />);
  expect(screen.queryByText(t('today.summary.ai_off'))).not.toBeOnTheScreen();
  expect(screen.queryByText(t('consent.paused'))).not.toBeOnTheScreen();
});

test('the companion note sits above the sections, and Reply opens the companion', async () => {
  resetAuth({ profile: { ...READY_PROFILE, onboardingCompletedAt: NOW.toISOString() } });
  await render(<Today />);
  expect(screen.getByText(t('today.note.by_now'))).toBeOnTheScreen();
  expect(textIndex(t('today.note.first'))).toBeLessThan(textIndex(t('today.signals.title')));

  await fireEvent.press(screen.getByRole('button', { name: t('today.note.reply') }));
  expect(router.push).toHaveBeenCalledWith('/companion');
});

test('during an attack the note says Nimbo is here', async () => {
  startEpisode('user-1', new Date(2026, 10, 26, 13, 0));
  await render(<Today />);
  expect(screen.getByText(t('today.note.during'))).toBeOnTheScreen();
});

test('with the AI off the note has no Reply', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false, onboardingCompletedAt: NOW.toISOString() } });
  await render(<Today />);
  expect(screen.getByText(t('today.note.first'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('today.note.reply') })).not.toBeOnTheScreen();
});

async function pressDebrief(): Promise<string> {
  const ended = new Date(2026, 10, 25, 18, 40);
  const id = startEpisode('user-1', new Date(2026, 10, 25, 17, 0));
  endEpisode('user-1', id, ended);
  doCheckin();
  await render(<Today />);
  const title = t('signal.debrief.title');
  const reason = t('signal.debrief.reason', { time: formatClock(ended, 'en') });
  await fireEvent.press(screen.getByRole('button', { name: `${title}. ${reason}` }));
  await fireEvent.press(screen.getByRole('button', { name: t('signal.debrief.action') }));
  return id;
}

test('the debrief row opens the companion on that attack with the AI on', async () => {
  const id = await pressDebrief();
  expect(router.push).toHaveBeenCalledWith({ pathname: '/companion', params: { debrief: id } });
});

test('with the AI off the debrief row opens the attack instead', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  const id = await pressDebrief();
  expect(router.push).toHaveBeenCalledWith({ pathname: '/episode/[id]', params: { id } });
});

test('with no check-in for days, the row’s action goes to the check-in card', async () => {
  await render(<Today />);
  await fireEvent.press(screen.getByRole('button', { name: `${t('signal.quiet.title')}. ${t('signal.quiet.reason')}` }));
  await fireEvent.press(screen.getByRole('button', { name: t('signal.quiet.action') }));
  expect(router.push).not.toHaveBeenCalled();
  expect(screen.getByRole('header', { name: t('today.checkin.title') })).toBeOnTheScreen();
});
