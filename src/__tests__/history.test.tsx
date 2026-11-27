import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import History from '../app/(tabs)/history';
import { saveMedication } from '../cabinet/medicationStore';
import { logDose } from '../cabinet/doseStore';
import { saveCheckin } from '../checkin/checkinStore';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { resetAuth } from '../test/authMock';
import { seedEpisode } from '../test/episodeSeed';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: jest.fn() }));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
// 26 November 2026, local noon: the calendar opens on that month and "30 days" is counted from it.
const NOW = new Date(2026, 10, 26, 12);
const day = (date: number, hour = 10): Date => new Date(2026, 10, date, hour);
const MED_ID = '00000000-0000-4000-8000-0000000000b1';

function rowIds(): string[] {
  return screen.queryAllByTestId(/^episode-row-/).map((node) => String(node.props.testID).replace('episode-row-', ''));
}

async function openList(): Promise<void> {
  await fireEvent.press(screen.getByRole('tab', { name: t('history.view.list') }));
}

let errors: jest.SpyInstance;

beforeEach(() => {
  errors = jest.spyOn(console, 'error');
  // Only the clock is faked: timers, microtasks and frames keep running as they do for every other suite.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime'],
  });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
});

afterEach(() => {
  jest.useRealTimers();
  // A calendar that reuses a key between blanks and days logs this, and the grid then misrenders.
  const duplicate = errors.mock.calls.filter((call) => String(call[0]).includes('same key'));
  errors.mockRestore();
  expect(duplicate).toEqual([]);
});

test('with no attacks it shows the calendar and says what will fill it', async () => {
  await render(<History />);
  expect(screen.getByText(t('history.empty.title'))).toBeTruthy();
  expect(screen.getByText(t('history.empty.body'))).toBeTruthy();
  expect(screen.getByRole('tab', { name: t('history.view.calendar') })).toBeSelected();
  // The next month is out of reach: nothing is logged in the future.
  expect(screen.getByRole('button', { name: t('history.next') })).toBeDisabled();
});

test('the list shows the attacks newest first, grouped by month', async () => {
  const oldest = seedEpisode('user-1', new Date(2026, 9, 21, 19), new Date(2026, 9, 21, 23), { intensity: 4 });
  const newest = seedEpisode('user-1', day(25, 14), day(25, 18), { intensity: 6 });
  const middle = seedEpisode('user-1', day(9, 18), day(9, 20), { intensity: 6 });
  await render(<History />);
  await openList();

  expect(rowIds()).toEqual([newest, middle, oldest]);
  expect(screen.getByText('November 2026')).toBeTruthy();
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(screen.queryByText(t('history.empty.title'))).toBeNull();
});

test('a row opens the attack', async () => {
  const id = seedEpisode('user-1', day(25, 14), day(25, 18), { intensity: 6 });
  await render(<History />);
  await openList();
  await fireEvent.press(screen.getByTestId(`episode-row-${id}`));
  const { router } = jest.requireMock<typeof import('expo-router')>('expo-router');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/episode/[id]', params: { id } });
});

test('the calendar puts the highest intensity of the day on an attack day and a dot on a check-in day', async () => {
  seedEpisode('user-1', day(20, 8), day(20, 9), { intensity: 5 });
  seedEpisode('user-1', day(20, 15), day(20, 17), { intensity: 8 });
  saveCheckin('user-1', '2026-11-18', { sleepBand: '6_7', stress: 'low' });
  await render(<History />);

  const attackDay = screen.getByLabelText(/November 20/);
  expect(within(attackDay).getByText('8')).toBeTruthy();
  expect(within(attackDay).queryByTestId('checkin-dot')).toBeNull();
  const checkinDay = screen.getByLabelText(/November 18/);
  expect(within(checkinDay).getByTestId('checkin-dot')).toBeTruthy();
  expect(screen.getByText(t('history.legend.attack'))).toBeTruthy();
  expect(screen.getByText(t('history.legend.checkin'))).toBeTruthy();
  // Two attacks in the month; no doses.
  expect(screen.getByText('2 attacks, 0 days with a dose')).toBeTruthy();
});

test('the month summary counts the days that have a dose, and is singular for one', async () => {
  const id = seedEpisode('user-1', day(20), day(20, 12), { intensity: 5 });
  saveMedication('user-1', MED_ID, {
    name: 'Ibuprofen', kind: 'acute', form: 'oral', medicationClass: 'simple_analgesic', doseText: null, minIntervalHours: null,
    schedule: null, scheduleTime: null, scheduleAnchor: null, archived: false,
  });
  logDose('user-1', { medicationId: MED_ID, takenAt: day(20, 11), episodeId: id });
  await render(<History />);
  expect(screen.getByText('1 attack, 1 day with a dose')).toBeTruthy();
});

test('a day with an attack lists it below the calendar, and the months can be walked back', async () => {
  const id = seedEpisode('user-1', day(20, 8), day(20, 9), { intensity: 5 });
  await render(<History />);
  expect(screen.queryByTestId(`episode-row-${id}`)).toBeNull();
  await fireEvent.press(screen.getByLabelText(/November 20/));
  expect(screen.getByTestId(`episode-row-${id}`)).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: t('history.prev') }));
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(screen.getByRole('button', { name: t('history.next') })).toBeEnabled();
});

test('the filter sheet names how many attacks apply, in the plural form of that count', async () => {
  seedEpisode('user-1', day(20, 8), day(20, 9), { intensity: 8 });
  seedEpisode('user-1', day(21, 8), day(21, 9), { intensity: 5 });
  seedEpisode('user-1', day(22, 8), day(22, 9), { intensity: 6 });
  await render(<History />);
  await openList();
  await fireEvent.press(screen.getByRole('button', { name: t('history.filters') }));

  expect(screen.getByRole('button', { name: 'Show 3 attacks' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: t('history.filter.min', { n: 7 }) }));
  expect(screen.getByRole('button', { name: 'Show 1 attack' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: t('history.filter.min', { n: 4 }) }));
  expect(screen.getByRole('button', { name: 'Show 3 attacks' })).toBeTruthy();

  await fireEvent.press(screen.getByRole('radio', { name: t('history.filter.min', { n: 7 }) }));
  await fireEvent.press(screen.getByRole('button', { name: 'Show 1 attack' }));
  expect(rowIds()).toHaveLength(1);
});

test('Clear filters in the sheet resets the choices', async () => {
  seedEpisode('user-1', day(20, 8), day(20, 9), { intensity: 8 });
  seedEpisode('user-1', day(21, 8), day(21, 9), { intensity: 5 });
  await render(<History />);
  await openList();
  await fireEvent.press(screen.getByRole('button', { name: t('history.filters') }));
  await fireEvent.press(screen.getByRole('radio', { name: t('history.filter.min', { n: 7 }) }));
  expect(screen.getByRole('button', { name: 'Show 1 attack' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: t('history.filter.clear') }));
  expect(screen.getByRole('button', { name: 'Show 2 attacks' })).toBeTruthy();
});

test('the search finds an attack by its notes, ignoring accents', async () => {
  const coffee = seedEpisode('user-1', day(20, 8), day(20, 9), { notes: 'After a strong café' });
  seedEpisode('user-1', day(21, 8), day(21, 9), { notes: 'Office' });
  await render(<History />);
  await openList();
  await fireEvent.changeText(screen.getByLabelText(t('history.search.label')), 'CAFE');
  expect(rowIds()).toEqual([coffee]);
});

test('filter=doses opens the list with the attacks that have a dose in the last 30 days', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ filter: 'doses' });
  const treated = seedEpisode('user-1', day(20), day(20, 12), { intensity: 5 });
  seedEpisode('user-1', day(21), day(21, 12), { intensity: 5 });
  seedEpisode('user-1', new Date(2026, 8, 1, 10), new Date(2026, 8, 1, 12), { intensity: 5 });
  saveMedication('user-1', MED_ID, {
    name: 'Ibuprofen', kind: 'acute', form: 'oral', medicationClass: 'simple_analgesic', doseText: null, minIntervalHours: null,
    schedule: null, scheduleTime: null, scheduleAnchor: null, archived: false,
  });
  logDose('user-1', { medicationId: MED_ID, takenAt: day(20, 11), episodeId: treated });
  await render(<History />);

  expect(screen.getByRole('tab', { name: t('history.view.list') })).toBeSelected();
  expect(rowIds()).toEqual([treated]);
});
