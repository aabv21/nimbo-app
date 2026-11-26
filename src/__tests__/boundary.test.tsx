import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Boundary from '../app/welcome/boundary';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { acceptTerms } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../profile/profileRepository', () => ({ acceptTerms: jest.fn(), setAiConsent: jest.fn() }));

const t = (key: MessageKey): string => translate('en', key);
const mockedAccept = jest.mocked(acceptTerms);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth({ profile: { ...READY_PROFILE, adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null } });
});

test('continue stays disabled until both statements are checked', async () => {
  await render(<Boundary />);
  const next = screen.getByRole('button', { name: t('boundary.continue') });
  expect(next).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeDisabled();

  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeEnabled();
  expect(mockedAccept).not.toHaveBeenCalled();
});

test('accepting calls acceptTerms once and shows the stamped consent fields without another read', async () => {
  mockedAccept.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiConsentAnsweredAt: null } });
  await render(<Boundary />);
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  await fireEvent.press(screen.getByRole('button', { name: t('boundary.continue') }));

  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({
      adultConfirmedAt: READY_PROFILE.adultConfirmedAt,
      boundaryAcceptedAt: READY_PROFILE.boundaryAcceptedAt,
    });
  });
  expect(mockedAccept).toHaveBeenCalledTimes(1);
  expect(currentAuth().refreshProfile).not.toHaveBeenCalled();
});

test('a failed call shows the error and keeps the user on the screen', async () => {
  mockedAccept.mockResolvedValue({ ok: false, kind: 'network' });
  await render(<Boundary />);
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  await fireEvent.press(screen.getByRole('button', { name: t('boundary.continue') }));

  expect(await screen.findByText(t('boundary.error'))).toBeOnTheScreen();
  expect(currentAuth().patchProfile).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeEnabled();
});
