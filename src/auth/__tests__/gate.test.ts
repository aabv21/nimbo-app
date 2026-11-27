import { kvSet } from '../../lib/kv';
import { READY_PROFILE } from '../../test/authMock';
import { readCachedProfileSync } from '../../profile/profileRepository';
import { nextRoute } from '../gate';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

const done = '2026-11-26T00:00:00Z';
const seen = { introSeen: true };
const consented = { adultConfirmedAt: done, boundaryAcceptedAt: done, aiConsentAnsweredAt: done };

test.each([
  [{ status: 'loading', profile: null }, '/loading'],
  [{ status: 'signedOut', profile: null }, '/sign-in'],
  // A signed-in user whose profile could not be read is never sent to the consent screens.
  [{ status: 'signedIn', profile: null }, '/loading'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null, onboardingCompletedAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: done, boundaryAcceptedAt: null, aiConsentAnsweredAt: null, onboardingCompletedAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: null, boundaryAcceptedAt: done, aiConsentAnsweredAt: null, onboardingCompletedAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: done, boundaryAcceptedAt: done, aiConsentAnsweredAt: null, onboardingCompletedAt: null } }, '/welcome/ai-consent'],
  [{ status: 'signedIn', profile: { ...consented, onboardingCompletedAt: null } }, '/welcome/triggers'],
  [{ status: 'signedIn', profile: { ...consented, onboardingCompletedAt: done } }, '/today'],
] as const)('nextRoute(%j) is %s once the intro was seen', (auth, route) => {
  expect(nextRoute(auth, seen)).toBe(route);
});

test('a signed-out phone that never saw the intro opens on it', () => {
  expect(nextRoute({ status: 'signedOut', profile: null }, { introSeen: false })).toBe('/intro');
});

test('the intro flag matters only while signed out', () => {
  expect(nextRoute({ status: 'loading', profile: null }, { introSeen: false })).toBe('/loading');
  expect(nextRoute({ status: 'signedIn', profile: { ...consented, onboardingCompletedAt: done } }, { introSeen: false })).toBe('/today');
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
