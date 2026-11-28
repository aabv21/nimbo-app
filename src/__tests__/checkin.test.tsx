import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CheckinSheet from '../app/checkin';
import { saveCheckin } from '../checkin/checkinStore';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { listOutbox } from '../lib/outbox/outbox';
import { localDate } from '../lib/localDate';
import { resetAuth, setAuth } from '../test/authMock';
import { READY_PROFILE } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

const t = (key: MessageKey): string => translate('en', key);
const TODAY = localDate();

beforeEach(() => {
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
});

afterEach(() => {
  jest.useRealTimers();
});

test('the period toggle is hidden without the opt-in and shown with it', async () => {
  const hidden = await render(<CheckinSheet />);
  expect(screen.queryByRole('checkbox', { name: t('checkin.period') })).toBeNull();
  expect(screen.queryByText(t('checkin.period.note'))).toBeNull();
  await hidden.unmount();

  setAuth({ profile: { ...READY_PROFILE, trackPeriod: true } });
  await render(<CheckinSheet />);
  expect(screen.getByRole('checkbox', { name: t('checkin.period') })).toBeTruthy();
  expect(screen.getByText(t('checkin.period.note'))).toBeTruthy();
});

test('shows the sleep, quality and stress questions and the five optional toggles', async () => {
  await render(<CheckinSheet />);
  // 5 sleep bands, 3 qualities and 3 stress levels.
  expect(screen.getAllByRole('radio')).toHaveLength(11);
  expect(screen.getAllByRole('checkbox')).toHaveLength(5);
  expect(screen.getByText(t('checkin.optional'))).toBeTruthy();
});

test('Save sends only the fields that changed since the day was last saved', async () => {
  saveCheckin('user-1', TODAY, { sleepBand: '6_7', stress: 'low' });
  await render(<CheckinSheet />);
  expect(screen.getByRole('radio', { name: t('checkin.sleep.6_7') })).toBeChecked();

  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.high') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('checkin.water') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

  const ops = listOutbox('user-1');
  expect(ops).toHaveLength(2);
  expect(ops[1]?.args).toEqual({ p_local_date: TODAY, p_fields: { stress: 'high', low_water: true } });
});

test('a fresh day sends every answer given, and nothing else', async () => {
  setAuth({ profile: { ...READY_PROFILE, trackPeriod: true } });
  await render(<CheckinSheet />);

  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.quality.ok') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('checkin.period') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

  expect(listOutbox('user-1')[0]?.args).toEqual({ p_local_date: TODAY, p_fields: { sleep_quality: 'ok', period_started: true } });
});

test('Save with nothing changed queues nothing', async () => {
  await render(<CheckinSheet />);
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
  expect(listOutbox('user-1')).toEqual([]);
});

test('after a save the button says Done for a second, then the sheet closes', async () => {
  jest.useFakeTimers();
  await render(<CheckinSheet />);
  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.mid') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

  expect(screen.getByRole('button', { name: t('common.done') })).toBeTruthy();
  expect(router.back).not.toHaveBeenCalled();
  await act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('tapping the scrim closes the sheet without saving', async () => {
  await render(<CheckinSheet />);
  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.mid') }));
  // The modal sheet hides the scrim from the accessibility tree; it is still the touch target outside the sheet.
  const [scrim] = screen.getAllByRole('button', { name: t('common.close'), includeHiddenElements: true });
  await fireEvent.press(scrim as never);
  expect(router.back).toHaveBeenCalledTimes(1);
  expect(listOutbox('user-1')).toEqual([]);
});

test('Close leaves without saving', async () => {
  await render(<CheckinSheet />);
  await fireEvent.press(screen.getByRole('radio', { name: t('checkin.stress.mid') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.close') }));
  expect(router.back).toHaveBeenCalled();
  expect(listOutbox('user-1')).toEqual([]);
});
