import { fireEvent, render, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Linking, StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import UrgentCare from '../app/urgent-care';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import type { ThemeName } from '../profile/profileRepository';
import { currentUrgentCare, showUrgentCare } from '../redflags/urgentCare';
import type { UrgentCareRequest } from '../redflags/urgentCare';
import { contrast } from '../ui/contrast';
import { themeOf } from '../ui/theme';
import { ThemeContext } from '../ui/themeContext';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) } }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const openURL = jest.spyOn(Linking, 'openURL');

const TEXT_HIT: UrgentCareRequest = {
  flags: ['thunderclap'],
  excerpt: 'the worst headache of my life, it came on all at once',
  source: 'text',
  episodeId: null,
};

function region(code: string | null): void {
  jest.mocked(getLocales).mockReturnValue([
    { languageTag: 'en-US', languageCode: 'en', regionCode: code, currencyCode: null } as ReturnType<typeof getLocales>[number],
  ]);
}

async function open(request: UrgentCareRequest, theme: ThemeName = 'day'): Promise<void> {
  showUrgentCare(request);
  await render(
    <ThemeContext.Provider value={{ name: theme, reduceMotion: false, forceDim: jest.fn() }}>
      <UrgentCare />
    </ThemeContext.Provider>,
  );
}

function styleOf(node: TestInstance): { backgroundColor?: unknown; color?: unknown } {
  return StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as { backgroundColor?: unknown; color?: unknown };
}

beforeEach(() => {
  jest.clearAllMocks();
  openURL.mockResolvedValue(undefined);
  region('US');
});

test('showUrgentCare pushes the screen with no health text in the route', async () => {
  await open(TEXT_HIT);
  expect(router.push).toHaveBeenCalledWith('/urgent-care');
});

test('a text hit shows the excerpt, the why line and the company line, with a warning haptic', async () => {
  await open(TEXT_HIT);
  expect(screen.getByRole('header', { name: t('redflag.title') })).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.detected.text'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.excerpt', { text: TEXT_HIT.excerpt ?? '' }))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.why.thunderclap'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.company'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.source'))).toBeOnTheScreen();
  expect(Haptics.notificationAsync).toHaveBeenCalledWith(Haptics.NotificationFeedbackType.Warning);
});

test('leaving the screen forgets the request, so opening it again shows no excerpt', async () => {
  await open(TEXT_HIT);
  expect(screen.getByText(t('redflag.excerpt', { text: TEXT_HIT.excerpt ?? '' }))).toBeOnTheScreen();
  await screen.unmount();
  expect(currentUrgentCare()).toBeNull();
  await render(<UrgentCare />);
  expect(screen.queryByText(t('redflag.excerpt', { text: TEXT_HIT.excerpt ?? '' }))).toBeNull();
  expect(screen.queryByText(t('redflag.detected.text'))).toBeNull();
});

test('a voice hit says what you said and lists every flag once', async () => {
  await open({ flags: ['weakness', 'pregnancy'], excerpt: 'my face is numb', source: 'voice', episodeId: null });
  expect(screen.getByText(t('redflag.detected.voice'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.why.weakness'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.why.pregnancy'))).toBeOnTheScreen();
});

test('with region BR the call button reads "Call 192" and opens tel:192', async () => {
  region('BR');
  await open(TEXT_HIT);
  expect(screen.getByText('Call 192')).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.call_sub', { region: t('region.br') }))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: /Call 192/ }));
  expect(openURL).toHaveBeenCalledWith('tel:192');
});

test.each([['ZZ'], [null]])('with region %s it shows the unknown-number lines and opens an empty dialer', async (code) => {
  region(code);
  await open(TEXT_HIT);
  expect(screen.getByText(t('redflag.unknown'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.unknown_why'))).toBeOnTheScreen();
  expect(screen.queryByText(t('redflag.source'))).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t('redflag.open_dialer') }));
  expect(openURL).toHaveBeenCalledWith('tel:');
});

test('a duration hit shows the long-attack lines and "It already ended" opens the episode editor', async () => {
  await open({ flags: ['long_attack'], excerpt: null, source: 'duration', episodeId: 'ep-1' });
  expect(screen.getByText(t('redflag.long'))).toBeOnTheScreen();
  expect(screen.getByText(t('redflag.why.long'))).toBeOnTheScreen();
  expect(screen.queryByText(t('redflag.detected.text'))).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: t('redflag.ended') }));
  expect(router.replace).toHaveBeenCalledWith('/episode/ep-1/edit');
});

test('"It already ended" is offered only for a duration hit', async () => {
  await open(TEXT_HIT);
  expect(screen.queryByRole('button', { name: t('redflag.ended') })).toBeNull();
});

test('"I\'m safe, continue" closes the screen', async () => {
  await open(TEXT_HIT);
  await fireEvent.press(screen.getByRole('button', { name: t('redflag.safe') }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('the call button is the first focusable control after the title', async () => {
  await open(TEXT_HIT);
  const focusable = screen.root?.queryAll(
    (node) => typeof node.type === 'string' && (node.props.accessibilityRole === 'header' || node.props.accessible === true),
  );
  expect(focusable?.[0]?.props.accessibilityRole).toBe('header');
  expect(focusable?.[1]?.props.accessibilityLabel).toMatch(/^Call 911/);
});

test.each(['day', 'dark', 'dim'] as const)('%s: the call button label/fill is at least 4.5:1 and its fill/ground at least 3:1', async (theme) => {
  await open(TEXT_HIT, theme);
  const button = screen.getByRole('button', { name: /Call 911/ });
  const fill = styleOf(button).backgroundColor;
  const ink = styleOf(screen.getByText('Call 911')).color;
  const { color } = themeOf(theme);
  expect(typeof fill).toBe('string');
  expect(typeof ink).toBe('string');
  expect(contrast(String(ink), String(fill))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(String(fill), color.bg)).toBeGreaterThanOrEqual(3);
});
