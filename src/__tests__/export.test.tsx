// "Export my data": the server's document becomes one file in the cache directory, shared through the share sheet.
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { exportData, exportFileName } from '../account/accountClient';
import { usePrivacyActions } from '../account/usePrivacyActions';
import { signOutLocally } from '../auth/emailAuth';
import ExportData from '../app/export';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { allowUserKeys, refuseUserKeys } from '../lib/kv';
import { readStoredSession } from '../lib/supabase';
import { resetAuth } from '../test/authMock';
import { cacheFiles, cacheFileText, resetFiles } from '../test/fileSystemMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('../lib/supabase', () => ({ supabase: {}, readStoredSession: jest.fn() }));
jest.mock('../auth/emailAuth', () => ({ signOutLocally: jest.fn(() => Promise.resolve()) }));
jest.mock('../account/accountClient', () => ({
  ...jest.requireActual<typeof import('../account/accountClient')>('../account/accountClient'),
  exportData: jest.fn(),
}));

const t = (key: MessageKey): string => translate('en', key);
const mockedExport = jest.mocked(exportData);
const JSON_TEXT = JSON.stringify({ schemaVersion: 1, episodes: [{ notes: 'aura before the pain' }] }, null, 2);

const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
  jest.spyOn(console, method).mockImplementation(() => undefined),
);

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  resetFiles();
  mockedExport.mockResolvedValue({ ok: true, json: JSON_TEXT });
  jest.mocked(readStoredSession).mockReturnValue({ userId: 'user-1', email: null });
  // An earlier export, and an unrelated cache file that stays.
  await new File(Paths.cache, 'nimbo-data-2026-11-01.json').write('{"old":true}');
  await new File(Paths.cache, 'image-cache.bin').write('x');
});

afterAll(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

test('run removes the earlier export, writes one file named for today, and shows it is ready', async () => {
  await render(<ExportData />);

  expect(screen.getByText(t('export.body'))).toBeOnTheScreen();
  expect(screen.queryByTestId('export-ready')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('export-run'));

  await waitFor(() => {
    expect(screen.getByTestId('export-ready')).toBeOnTheScreen();
  });
  expect(screen.getByText(t('export.ready'))).toBeOnTheScreen();
  expect(cacheFiles()).toEqual(['image-cache.bin', exportFileName()].sort());
  expect(cacheFileText(exportFileName())).toBe(JSON_TEXT);
});

test('share opens the share sheet with that file as JSON', async () => {
  await render(<ExportData />);
  await fireEvent.press(screen.getByTestId('export-run'));
  await waitFor(() => {
    expect(screen.getByTestId('export-share')).toBeOnTheScreen();
  });

  await fireEvent.press(screen.getByTestId('export-share'));

  await waitFor(() => {
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${Paths.cache.uri}${exportFileName()}`,
      expect.objectContaining({ mimeType: 'application/json', dialogTitle: t('export.title') }),
    );
  });
});

test('a failed export shows the message and writes nothing new', async () => {
  mockedExport.mockResolvedValue({ ok: false, error: 'network' });
  await render(<ExportData />);

  await fireEvent.press(screen.getByTestId('export-run'));

  await waitFor(() => {
    expect(screen.getByText(t('export.error'))).toBeOnTheScreen();
  });
  expect(screen.queryByTestId('export-ready')).not.toBeOnTheScreen();
  expect(cacheFiles()).toEqual(['image-cache.bin', 'nimbo-data-2026-11-01.json']);
});

test('a refused session asks to sign in again, as a deletion does, and signs out on this phone', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedExport.mockResolvedValue({ ok: false, error: 'reauth' });
  await render(<ExportData />);

  await fireEvent.press(screen.getByTestId('export-run'));

  await waitFor(() => {
    expect(alert).toHaveBeenCalledWith(t('export.error.reauth'));
  });
  expect(signOutLocally).toHaveBeenCalledTimes(1);
  expect(cacheFiles()).toEqual(['image-cache.bin', 'nimbo-data-2026-11-01.json']);
  alert.mockRestore();
});

test('a second run while the reauth sign-out is still going starts no new export', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  let signedOut: () => void = () => undefined;
  jest.mocked(signOutLocally).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      signedOut = resolve;
    }),
  );
  mockedExport.mockResolvedValue({ ok: false, error: 'reauth' });
  const { result } = await renderHook(() => usePrivacyActions('user-1'));

  await act(async () => {
    result.current.exporting.run();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(signOutLocally).toHaveBeenCalledTimes(1);
  });
  await act(async () => {
    result.current.exporting.run();
    await Promise.resolve();
  });
  expect(mockedExport).toHaveBeenCalledTimes(1);

  await act(async () => {
    signedOut();
    await Promise.resolve();
  });
  alert.mockRestore();
});

test('no share sheet on the phone shows the message', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false);
  await render(<ExportData />);
  await fireEvent.press(screen.getByTestId('export-run'));
  await waitFor(() => {
    expect(screen.getByTestId('export-share')).toBeOnTheScreen();
  });

  await fireEvent.press(screen.getByTestId('export-share'));

  await waitFor(() => {
    expect(screen.getByText(t('export.error'))).toBeOnTheScreen();
  });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

test("no console call carries the file's name or content", async () => {
  await render(<ExportData />);
  await fireEvent.press(screen.getByTestId('export-run'));
  await waitFor(() => {
    expect(screen.getByTestId('export-share')).toBeOnTheScreen();
  });
  await fireEvent.press(screen.getByTestId('export-share'));

  const logged = consoleSpies.flatMap((spy) => spy.mock.calls).map((call) => call.map(String).join(' '));
  for (const line of logged) {
    expect(line).not.toContain(exportFileName());
    expect(line).not.toContain('aura before the pain');
  }
});

describe('an answer that lands after the account left', () => {
  function pendingExport(): (value: Awaited<ReturnType<typeof exportData>>) => void {
    let finish: (value: Awaited<ReturnType<typeof exportData>>) => void = () => undefined;
    mockedExport.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    return finish;
  }

  test('a deletion on this phone meanwhile: the health data is dropped, no file is written', async () => {
    const finish = pendingExport();
    await render(<ExportData />);
    await fireEvent.press(screen.getByTestId('export-run'));

    refuseUserKeys('user-1');
    finish({ ok: true, json: JSON_TEXT });

    await waitFor(() => {
      expect(screen.getByText(t('export.error'))).toBeOnTheScreen();
    });
    expect(cacheFiles()).not.toContain(exportFileName());
    allowUserKeys('user-1');
  });

  test('a sign-out meanwhile: no file is written', async () => {
    const finish = pendingExport();
    await render(<ExportData />);
    await fireEvent.press(screen.getByTestId('export-run'));

    jest.mocked(readStoredSession).mockReturnValue(null);
    finish({ ok: true, json: JSON_TEXT });

    await waitFor(() => {
      expect(screen.getByText(t('export.error'))).toBeOnTheScreen();
    });
    expect(cacheFiles()).not.toContain(exportFileName());
  });

  test('the screen left meanwhile: no file is written', async () => {
    const finish = pendingExport();
    const view = await render(<ExportData />);
    await fireEvent.press(screen.getByTestId('export-run'));

    await view.unmount();
    finish({ ok: true, json: JSON_TEXT });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cacheFiles()).not.toContain(exportFileName());
  });
});
