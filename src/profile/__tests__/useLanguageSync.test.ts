import { act, renderHook } from '@testing-library/react-native';
import { createElement } from 'react';
import type { ReactNode } from 'react';

import { useI18n } from '../../i18n';
import { I18nProvider } from '../../i18n/I18nProvider';
import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { READY_PROFILE, currentAuth, resetAuth } from '../../test/authMock';
import { updateProfile } from '../profileRepository';
import { useLanguageSync } from '../useLanguageSync';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../profileRepository', () => ({ updateProfile: jest.fn() }));
let mockResume: () => void = () => undefined;
jest.mock('../../lib/useOnResume', () => ({
  useOnResume: (callback: () => void) => {
    mockResume = callback;
  },
}));
const mockDevice = { tag: 'en-US' };
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: mockDevice.tag }],
}));

const mockedUpdate = jest.mocked(updateProfile);

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return createElement(I18nProvider, null, children);
}

/** The hook under test, plus the locale the UI shows. */
async function mount(): Promise<{ locale: () => string; unmount: () => Promise<void> | void }> {
  const { result, unmount } = await renderHook(
    () => {
      useLanguageSync();
      return useI18n().locale;
    },
    { wrapper },
  );
  return { locale: () => result.current, unmount };
}

async function resume(): Promise<void> {
  await act(async () => {
    mockResume();
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockedUpdate.mockReset();
  kvRemove('locale-preference');
  mockDevice.tag = 'en-US';
});

test('a resolved Spanish UI with no saved language is sent once, even across two resumes in flight', async () => {
  mockDevice.tag = 'es-CO';
  resetAuth({ profile: { ...READY_PROFILE, language: null } });
  mockedUpdate.mockReturnValue(new Promise(() => undefined));

  const { locale } = await mount();
  await resume();
  await resume();

  expect(locale()).toBe('es');
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate).toHaveBeenCalledWith({ language: 'es' });
});

test('the saved language is shown at once, so a resume after it sends nothing', async () => {
  mockDevice.tag = 'es-CO';
  resetAuth({ profile: { ...READY_PROFILE, language: null } });
  mockedUpdate.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, language: 'es' } });

  await mount();
  await resume();

  expect(currentAuth().profile?.language).toBe('es');
  expect(mockedUpdate).toHaveBeenCalledTimes(1);
});

test('a fresh device in English for a Portuguese profile switches the UI to Portuguese and sends nothing', async () => {
  resetAuth({ profile: { ...READY_PROFILE, language: 'pt' } });

  const { locale } = await mount();
  await resume();

  expect(locale()).toBe('pt');
  expect(kvGet('locale-preference')).toBe('pt');
  expect(mockedUpdate).not.toHaveBeenCalled();
});

test('a device with a stored system preference is never overridden', async () => {
  kvSet('locale-preference', 'system');
  resetAuth({ profile: { ...READY_PROFILE, language: 'pt' } });
  mockedUpdate.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, language: 'en' } });

  const { locale } = await mount();

  expect(locale()).toBe('en');
  expect(kvGet('locale-preference')).toBe('system');
  expect(mockedUpdate).toHaveBeenCalledWith({ language: 'en' });
});

test('the first check on a fresh device is the only one: a later phone language is followed, not the profile', async () => {
  resetAuth({ profile: { ...READY_PROFILE, language: 'en' } });
  mockedUpdate.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, language: 'es' } });

  // Same language as the profile: nothing to adopt, but following the phone is now this device's stored choice.
  const first = await mount();
  expect(first.locale()).toBe('en');
  expect(kvGet('locale-preference')).toBe('system');
  expect(mockedUpdate).not.toHaveBeenCalled();
  await first.unmount();

  // The phone is switched to Spanish: the profile's English (only a synced value) does not pull the UI back.
  mockDevice.tag = 'es-ES';
  const second = await mount();
  expect(second.locale()).toBe('es');
  expect(mockedUpdate).toHaveBeenCalledWith({ language: 'es' });
});

test('when the languages already match, it never writes', async () => {
  kvSet('locale-preference', 'es');
  resetAuth({ profile: { ...READY_PROFILE, language: 'es' } });

  await mount();
  await resume();

  expect(mockedUpdate).not.toHaveBeenCalled();
});

test('a failed save is tried again on the next resume', async () => {
  kvSet('locale-preference', 'es');
  resetAuth({ profile: { ...READY_PROFILE, language: null } });
  mockedUpdate.mockResolvedValueOnce({ ok: false, kind: 'network' });
  mockedUpdate.mockResolvedValueOnce({ ok: true, value: { ...READY_PROFILE, language: 'es' } });

  await mount();
  await resume();

  expect(mockedUpdate).toHaveBeenCalledTimes(2);
  expect(currentAuth().profile?.language).toBe('es');
});
