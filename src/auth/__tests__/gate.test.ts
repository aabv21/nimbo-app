import { nextRoute } from '../gate';

const done = '2026-11-26T00:00:00Z';

test.each([
  [{ status: 'loading', profile: null }, '/loading'],
  [{ status: 'signedOut', profile: null }, '/sign-in'],
  // A signed-in user whose profile could not be read is never sent to the consent screens.
  [{ status: 'signedIn', profile: null }, '/loading'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: done, boundaryAcceptedAt: null, aiConsentAnsweredAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: null, boundaryAcceptedAt: done, aiConsentAnsweredAt: null } }, '/welcome/boundary'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: done, boundaryAcceptedAt: done, aiConsentAnsweredAt: null } }, '/welcome/ai-consent'],
  [{ status: 'signedIn', profile: { adultConfirmedAt: done, boundaryAcceptedAt: done, aiConsentAnsweredAt: done } }, '/today'],
] as const)('nextRoute(%j) is %s', (auth, route) => {
  expect(nextRoute(auth)).toBe(route);
});
