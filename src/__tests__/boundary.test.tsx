import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { policyUrl } from '../account/consent';
import Boundary from '../app/welcome/boundary';
import { translate } from '../i18n';
import type { Locale, MessageKey } from '../i18n';
import { I18nProvider } from '../i18n/I18nProvider';
import { kvRemove, kvSet } from '../lib/kv';
import { acceptTerms } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../profile/profileRepository', () => ({ acceptTerms: jest.fn(), setAiConsent: jest.fn() }));

const t = (key: MessageKey): string => translate('en', key);
const mockedAccept = jest.mocked(acceptTerms);
const openURL = jest.spyOn(Linking, 'openURL');
const PENDING = { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null, termsVersion: null };

/** The screen under the given UI language, chosen on this device like the Profile picker does. */
async function open(locale?: Locale): Promise<void> {
  if (locale === undefined) {
    kvRemove('locale-preference');
  } else {
    kvSet('locale-preference', locale);
  }
  await render(
    <I18nProvider>
      <Boundary />
    </I18nProvider>,
  );
}

async function tickAll(tr: (key: MessageKey) => string = t): Promise<void> {
  await fireEvent.press(screen.getByRole('checkbox', { name: tr('boundary.age') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: tr('boundary.notMedical') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: tr('boundary.health') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  openURL.mockResolvedValue(undefined);
  resetAuth({ profile: { ...READY_PROFILE, ...PENDING } });
});

test('continue stays disabled until all three statements are checked, the health data one last', async () => {
  await open();
  const next = screen.getByRole('button', { name: t('boundary.continue') });
  expect(next).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeDisabled();

  await fireEvent.press(screen.getByTestId('boundary-health'));
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeEnabled();
  expect(mockedAccept).not.toHaveBeenCalled();
});

test('the health data consent is its own checkbox under its own header, and says whether it is ticked', async () => {
  await open();
  expect(screen.getByRole('header', { name: t('boundary.health.title') })).toBeOnTheScreen();

  const row = screen.getByTestId('boundary-health');
  expect(row.props.accessibilityRole).toBe('checkbox');
  expect(row.props.accessibilityLabel).toBe(t('boundary.health'));
  expect(row.props.accessibilityState).toEqual({ checked: false });

  await fireEvent.press(row);
  expect(screen.getByTestId('boundary-health').props.accessibilityState).toEqual({ checked: true });
});

test('accepting under the Spanish UI calls acceptTerms with es and shows the stamped fields and version without another read', async () => {
  mockedAccept.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiConsentAnsweredAt: null } });
  const es = (key: MessageKey): string => translate('es', key);
  await open('es');
  await tickAll(es);
  await fireEvent.press(screen.getByRole('button', { name: es('boundary.continue') }));

  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({
      adultConfirmedAt: READY_PROFILE.adultConfirmedAt,
      boundaryAcceptedAt: READY_PROFILE.boundaryAcceptedAt,
      termsVersion: READY_PROFILE.termsVersion,
    });
  });
  expect(mockedAccept).toHaveBeenCalledTimes(1);
  expect(mockedAccept).toHaveBeenCalledWith('es');
  expect(currentAuth().refreshProfile).not.toHaveBeenCalled();
});

test('the terms link opens the policy in the UI language, as a link', async () => {
  await open('es');
  const link = screen.getByTestId('boundary-terms');
  expect(link.props.accessibilityRole).toBe('link');
  expect(link.props.accessibilityLabel).toBe(translate('es', 'boundary.terms'));

  await fireEvent.press(link);
  expect(openURL).toHaveBeenCalledWith(policyUrl('es'));
  expect(openURL).toHaveBeenCalledWith('https://aabv21.github.io/nimbo-privacy/es/');
});

test('a first acceptance shows no "updated" notice', async () => {
  await open();
  expect(screen.queryByText(t('boundary.updated'))).not.toBeOnTheScreen();
});

test('a stored older version shows the "updated" notice above the boxes', async () => {
  resetAuth({ profile: { ...READY_PROFILE, termsVersion: '2026-11-01' } });
  await open();
  expect(screen.getByText(t('boundary.updated'))).toBeOnTheScreen();
  // Re-accepting a newer text starts from empty boxes.
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeDisabled();
});

test('a terms re-consent keeps an emergency call on the screen, which dials the region\'s number', async () => {
  // The test phone's region is the US (jest.setup.ts).
  resetAuth({ profile: { ...READY_PROFILE, termsVersion: '2026-11-01' } });
  await open();
  expect(screen.getByText(t('boundary.emergency'))).toBeOnTheScreen();

  const call = screen.getByTestId('boundary-emergency-call');
  expect(call.props.accessibilityLabel).toContain(translate('en', 'redflag.call', { number: '911' }));
  await fireEvent.press(call);
  expect(openURL).toHaveBeenCalledWith('tel:911');
});

test('a first acceptance shows no emergency call: nothing the user could reach before is behind this screen', async () => {
  await open();
  expect(screen.queryByTestId('boundary-emergency-call')).not.toBeOnTheScreen();
  expect(screen.queryByText(t('boundary.emergency'))).not.toBeOnTheScreen();
});

test('a failed call shows the error and keeps the user on the screen', async () => {
  mockedAccept.mockResolvedValue({ ok: false, kind: 'network' });
  await open();
  await tickAll();
  await fireEvent.press(screen.getByRole('button', { name: t('boundary.continue') }));

  expect(await screen.findByText(t('boundary.error'))).toBeOnTheScreen();
  expect(currentAuth().patchProfile).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeEnabled();
});
