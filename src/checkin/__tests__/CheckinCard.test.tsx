import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { translate } from '../../i18n';
import type { MessageKey, Params } from '../../i18n';
import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { localDate } from '../../lib/localDate';
import { clearLocalDb } from '../../test/localDbTest';
import { CheckinCard } from '../CheckinCard';
import * as store from '../checkinStore';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
// A screen is focused once, on mount; `mockFocus.again()` focuses it again, as coming back to it does.
const mockFocus: { effects: Set<() => void>; again: () => void } = {
  effects: new Set(),
  again: () => {
    for (const effect of mockFocus.effects) effect();
  },
};
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    mockFocus.effects.add(effect);
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const TODAY = localDate();

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  clearLocalDb();
});

const sleep = (name: string): ReturnType<typeof screen.getByRole> => screen.getByRole('radio', { name });

test('after the sleep tap nothing is saved', async () => {
  const save = jest.spyOn(store, 'saveCheckin');
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);

  await fireEvent.press(sleep(t('checkin.sleep.6_7')));

  expect(save).not.toHaveBeenCalled();
  expect(listOutbox('user-1')).toEqual([]);
  expect(sleep(t('checkin.sleep.6_7'))).toBeChecked();
});

test('the stress tap saves both answers at once and the card shows the done line', async () => {
  const save = jest.spyOn(store, 'saveCheckin');
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);

  await fireEvent.press(sleep(t('checkin.sleep.6_7')));
  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.low') }));

  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith('user-1', TODAY, { sleepBand: '6_7', stress: 'low' });
  expect(await screen.findByText('Done today: 6 to 7 h of sleep, low stress.')).toBeTruthy();
  expect(screen.queryByRole('radio')).toBeNull();
  expect(listOutbox('user-1')).toHaveLength(1);
});

test('answering stress first works too: the second answer, whichever it is, saves', async () => {
  const save = jest.spyOn(store, 'saveCheckin');
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);

  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.high') }));
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(sleep(t('checkin.sleep.lt5')));

  expect(save).toHaveBeenCalledWith('user-1', TODAY, { sleepBand: 'lt5', stress: 'high' });
});

test('Change reopens the questions with the saved answers marked, and a new answer saves at once', async () => {
  store.saveCheckin('user-1', TODAY, { sleepBand: '7_8', stress: 'mid' });
  const save = jest.spyOn(store, 'saveCheckin');
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);
  expect(await screen.findByText('Done today: 7 to 8 h of sleep, medium stress.')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: t('common.change') }));
  expect(sleep(t('checkin.sleep.7_8'))).toBeChecked();
  expect(screen.getByRole('radio', { name: t('checkin.stress.mid') })).toBeChecked();

  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.high') }));
  expect(save).toHaveBeenCalledWith('user-1', TODAY, { sleepBand: '7_8', stress: 'high' });
  expect(await screen.findByText('Done today: 7 to 8 h of sleep, high stress.')).toBeTruthy();
});

test('More details opens the check-in sheet', async () => {
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);
  await fireEvent.press(screen.getByRole('button', { name: t('today.checkin.more') }));
  expect(router.push).toHaveBeenCalledWith('/checkin');
});

test('a double tap on More details opens the sheet once; back on Today, it opens again', async () => {
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);
  const more = screen.getByRole('button', { name: t('today.checkin.more') });
  await fireEvent.press(more);
  await fireEvent.press(more);
  expect(router.push).toHaveBeenCalledTimes(1);

  await act(() => {
    mockFocus.again();
  });
  await fireEvent.press(more);
  expect(router.push).toHaveBeenCalledTimes(2);
});

test('a day answered only on the sheet (no stress) still asks the two questions', async () => {
  store.saveCheckin('user-1', TODAY, { sleepBand: '5_6', alcohol: true });
  await render(<CheckinCard userId="user-1" localDate={TODAY} />);
  expect(sleep(t('checkin.sleep.5_6'))).toBeChecked();
  expect(localDb().getAllSync('SELECT 1 FROM checkins;')).toHaveLength(1);
});
