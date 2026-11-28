import { act, renderHook } from '@testing-library/react-native';

import { READY_PROFILE, currentAuth, resetAuth } from '../../test/authMock';
import { updateProfile } from '../profileRepository';
import { useTimezoneSync } from '../useTimezoneSync';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../profileRepository', () => ({ updateProfile: jest.fn() }));
let mockResume: () => void = () => undefined;
jest.mock('../../lib/useOnResume', () => ({
  useOnResume: (callback: () => void) => {
    mockResume = callback;
  },
}));

const mockedUpdate = jest.mocked(updateProfile);

function deviceZone(timeZone: string): void {
  const real = new Intl.DateTimeFormat().resolvedOptions();
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone });
}

async function resume(): Promise<void> {
  await act(async () => {
    mockResume();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  mockedUpdate.mockReset();
});

test('a device zone that differs from the profile is saved once, on mount', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'UTC' } });
  deviceZone('Europe/Madrid');
  // Pending, so the profile still says UTC when the app resumes.
  mockedUpdate.mockReturnValue(new Promise(() => undefined));

  await renderHook(() => {
    useTimezoneSync();
  });
  await resume();

  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate).toHaveBeenCalledWith({ timezone: 'Europe/Madrid' });
});

test('the saved zone is shown at once, so a resume after it sends nothing', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'UTC' } });
  deviceZone('Europe/Madrid');
  mockedUpdate.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, timezone: 'Europe/Madrid' } });

  await renderHook(() => {
    useTimezoneSync();
  });
  await resume();

  expect(currentAuth().profile?.timezone).toBe('Europe/Madrid');
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
});

test('on resume after a trip, the new zone is saved', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'Europe/Madrid' } });
  deviceZone('Europe/Madrid');
  mockedUpdate.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, timezone: 'America/Bogota' } });

  await renderHook(() => {
    useTimezoneSync();
  });
  expect(mockedUpdate).not.toHaveBeenCalled();

  deviceZone('America/Bogota');
  await resume();
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate).toHaveBeenCalledWith({ timezone: 'America/Bogota' });
});

test('when the zones are equal, it never writes', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'Europe/Madrid' } });
  deviceZone('Europe/Madrid');

  await renderHook(() => {
    useTimezoneSync();
  });
  await resume();

  expect(mockedUpdate).not.toHaveBeenCalled();
});

test('a failed save is tried again on the next resume', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'UTC' } });
  deviceZone('Europe/Madrid');
  mockedUpdate.mockResolvedValueOnce({ ok: false, kind: 'network' });
  mockedUpdate.mockResolvedValueOnce({ ok: true, value: { ...READY_PROFILE, timezone: 'Europe/Madrid' } });

  await renderHook(() => {
    useTimezoneSync();
  });
  await resume();

  expect(mockedUpdate).toHaveBeenCalledTimes(2);
  expect(currentAuth().profile?.timezone).toBe('Europe/Madrid');
});

test('a zone the server refused is not sent again on resume, and the next device zone is', async () => {
  resetAuth({ profile: { ...READY_PROFILE, timezone: 'UTC' } });
  deviceZone('EST');
  mockedUpdate.mockResolvedValueOnce({ ok: false, kind: 'invalid' });
  mockedUpdate.mockResolvedValueOnce({ ok: true, value: { ...READY_PROFILE, timezone: 'America/New_York' } });

  await renderHook(() => {
    useTimezoneSync();
  });
  await resume();
  await resume();
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate).toHaveBeenCalledWith({ timezone: 'EST' });

  deviceZone('America/New_York');
  await resume();
  expect(mockedUpdate).toHaveBeenCalledTimes(2);
  expect(mockedUpdate).toHaveBeenLastCalledWith({ timezone: 'America/New_York' });
  expect(currentAuth().profile?.timezone).toBe('America/New_York');
});
