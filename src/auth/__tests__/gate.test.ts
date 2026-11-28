import { kvSet } from '../../lib/kv';
import { READY_PROFILE } from '../../test/authMock';
import { readCachedProfileSync } from '../../profile/profileRepository';
import { nextRoute } from '../gate';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

const done = '2026-11-26T00:00:00Z';
const seen = { introSeen: true };
// Answered to this build's texts, with the AI off.
const current = { termsVersion: '2026-12-01', aiEnabled: false, aiConsentVersion: '2026-12-01' };
const pending = { ...current, adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null, onboardingCompletedAt: null };
const consented = { ...current, adultConfirmedAt: done, boundaryAcceptedAt: done, aiConsentAnsweredAt: done };
const onboarded = { ...consented, onboardingCompletedAt: done };

test.each([
  [{ status: 'loading', profile: null }, '/loading'],
  [{ status: 'signedOut', profile: null }, '/sign-in'],
  // A signed-in user whose profile could not be read is never sent to the consent screens.
  [{ status: 'signedIn', profile: null }, '/loading'],
  [{ status: 'signedIn', profile: { ...pending, termsVersion: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { ...pending, adultConfirmedAt: done } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { ...pending, boundaryAcceptedAt: done } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { ...pending, adultConfirmedAt: done, boundaryAcceptedAt: done } }, '/welcome/ai-consent'],
  [{ status: 'signedIn', profile: { ...consented, onboardingCompletedAt: null } }, '/welcome/triggers'],
  [{ status: 'signedIn', profile: onboarded }, '/today'],
  // Terms re-consent: an answer to an older text is asked again, onboarded or not; a newer one is never downgraded.
  [{ status: 'signedIn', profile: { ...onboarded, termsVersion: '2026-11-01' } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { ...onboarded, termsVersion: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { ...onboarded, termsVersion: '2027-01-01' } }, '/today'],
  // AI re-consent never locks an onboarded user out (offline included): Today, with the AI off on the phone (`aiActive`).
  [{ status: 'signedIn', profile: { ...onboarded, aiEnabled: true, aiConsentVersion: null } }, '/today'],
  [{ status: 'signedIn', profile: { ...onboarded, aiEnabled: true, aiConsentVersion: '2026-11-01' } }, '/today'],
  // Before onboarding ends, an older AI answer is asked again on its screen.
  [{ status: 'signedIn', profile: { ...consented, onboardingCompletedAt: null, aiEnabled: true, aiConsentVersion: '2026-11-01' } }, '/welcome/ai-consent'],
  [{ status: 'signedIn', profile: { ...onboarded, aiEnabled: true, aiConsentVersion: '2026-12-01' } }, '/today'],
  [{ status: 'signedIn', profile: { ...onboarded, aiEnabled: false, aiConsentVersion: null } }, '/today'],
  // Terms come first: both outdated opens the boundary.
  [{ status: 'signedIn', profile: { ...onboarded, termsVersion: '2026-11-01', aiEnabled: true, aiConsentVersion: null } }, '/welcome/boundary'],
] as const)('nextRoute(%j) is %s once the intro was seen', (auth, route) => {
  expect(nextRoute(auth, seen)).toBe(route);
});

test('a signed-out phone that never saw the intro opens on it', () => {
  expect(nextRoute({ status: 'signedOut', profile: null }, { introSeen: false })).toBe('/intro');
});

test('the intro flag matters only while signed out', () => {
  expect(nextRoute({ status: 'loading', profile: null }, { introSeen: false })).toBe('/loading');
  expect(nextRoute({ status: 'signedIn', profile: onboarded }, { introSeen: false })).toBe('/today');
});

// Never released, so only a development phone carries such a copy: it runs the setup steps once, never the loading view.
test('a profile cached by the previous build, opened offline, routes to the setup steps rather than the loading view', () => {
  const wave1: Record<string, unknown> = { ...READY_PROFILE, onboardingCompletedAt: null };
  delete wave1['knownTriggers'];
  delete wave1['priority'];
  delete wave1['trackPeriod'];
  kvSet('profile.u1', JSON.stringify(wave1));

  expect(nextRoute({ status: 'signedIn', profile: readCachedProfileSync('u1') }, seen)).toBe('/welcome/triggers');
});

test('a profile cached before consent versions existed, opened offline, asks for the terms again rather than the loading view', () => {
  const unversioned: Record<string, unknown> = { ...READY_PROFILE };
  delete unversioned['termsVersion'];
  delete unversioned['aiConsentVersion'];
  kvSet('profile.u2', JSON.stringify(unversioned));

  expect(nextRoute({ status: 'signedIn', profile: readCachedProfileSync('u2') }, seen)).toBe('/welcome/boundary');
});
