import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { SyncNotice } from '../SyncNotice';
import { useSyncState } from '../SyncProvider';

jest.mock('../SyncProvider', () => ({ useSyncState: jest.fn() }));

const retry = jest.fn();

function syncState(pending: number, failed: number): void {
  jest.mocked(useSyncState).mockReturnValue({ pending, failed, syncing: pending > 0, retry });
}

beforeEach(() => {
  jest.useFakeTimers();
  retry.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

test('renders nothing while everything is synced', async () => {
  syncState(0, 0);
  await render(<SyncNotice />);
  expect(screen.toJSON()).toBeNull();
});

test('pending work shows the status line only after 600 ms', async () => {
  syncState(2, 0);
  await render(<SyncNotice />);
  await act(() => {
    jest.advanceTimersByTime(599);
  });
  expect(screen.queryByText(/Saved on this phone, syncing/)).toBeNull();

  await act(() => {
    jest.advanceTimersByTime(1);
  });
  expect(screen.getByText('Saved on this phone, syncing. 2 records to upload')).toBeTruthy();
});

test('work that finishes within 600 ms never shows the line', async () => {
  syncState(1, 0);
  await render(<SyncNotice />);
  await act(() => {
    jest.advanceTimersByTime(300);
  });
  syncState(0, 0);
  await screen.rerender(<SyncNotice />);
  await act(() => {
    jest.advanceTimersByTime(600);
  });
  expect(screen.toJSON()).toBeNull();
});

test('a failure shows at once and "Try again" calls retry', async () => {
  syncState(0, 1);
  await render(<SyncNotice />);

  expect(screen.getByText('Couldn’t sync')).toBeTruthy();
  expect(screen.getByText(/Your record is still saved on this phone/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});
