import { renderHook } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';

import { READY_PROFILE, resetAuth } from '../../test/authMock';
import { showUrgentCare } from '../urgentCare';
import { useRedFlagCheck } from '../useRedFlagCheck';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../urgentCare', () => ({ showUrgentCare: jest.fn() }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

const show = jest.mocked(showUrgentCare);

function phoneLanguage(languageTag: string): void {
  const [languageCode = 'en', regionCode = null] = languageTag.split('-');
  jest.mocked(getLocales).mockReturnValue([
    { languageTag, languageCode, regionCode, currencyCode: null } as ReturnType<typeof getLocales>[number],
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  phoneLanguage('en-US');
});

test('a hit opens urgent care once with the excerpt and returns true', async () => {
  const { result } = await renderHook(() => useRedFlagCheck());
  expect(result.current('  The WORST headache of my life!!  ', 'text')).toBe(true);
  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith({
    flags: ['thunderclap'],
    excerpt: 'The WORST headache of my life!!',
    source: 'text',
    episodeId: null,
  });
});

test('an app in Spanish still catches a message written in English', async () => {
  phoneLanguage('es-MX');
  const { result } = await renderHook(() => useRedFlagCheck());
  expect(result.current('worst headache of my life', 'text')).toBe(true);
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ flags: ['thunderclap'], excerpt: 'worst headache of my life' }));
});

test('plain text returns false and opens nothing', async () => {
  const { result } = await renderHook(() => useRedFlagCheck());
  expect(result.current('the usual migraine, left temple, nausea', 'text')).toBe(false);
  expect(show).not.toHaveBeenCalled();
});

test('it works with the companion turned off', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  const { result } = await renderHook(() => useRedFlagCheck());
  expect(result.current('I hit my head on the door', 'text')).toBe(true);
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ flags: ['head_injury'] }));
});

test('the excerpt is the sentence that hit', async () => {
  const { result } = await renderHook(() => useRedFlagCheck());
  result.current('Bad day at work. Nausea since lunch!\nAnd now my face is numb. Should I lie down?', 'text');
  expect(show.mock.calls[0]?.[0].excerpt).toBe('And now my face is numb.');
});

test('a long excerpt is cut short', async () => {
  const { result } = await renderHook(() => useRedFlagCheck());
  result.current(`my face is numb ${'and the light hurts '.repeat(12)}`, 'text');
  const excerpt = show.mock.calls[0]?.[0].excerpt ?? '';
  expect(excerpt.length).toBeLessThanOrEqual(160);
  expect(excerpt.startsWith('my face is numb')).toBe(true);
  expect(excerpt.endsWith('…')).toBe(true);
});
