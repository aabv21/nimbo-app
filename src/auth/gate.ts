import type { Profile } from '../profile/profileRepository';

export type GateRoute = '/loading' | '/sign-in' | '/welcome/boundary' | '/welcome/ai-consent' | '/today';

/**
 * Where the signed-in state sends the user. A signed-in user whose profile could not be read stays on
 * `/loading`: an unread profile is not an unanswered consent, so it never reaches the consent screens.
 */
export function nextRoute(auth: {
  status: 'loading' | 'signedOut' | 'signedIn';
  profile: Pick<Profile, 'adultConfirmedAt' | 'boundaryAcceptedAt' | 'aiConsentAnsweredAt'> | null;
}): GateRoute {
  if (auth.status === 'loading') return '/loading';
  if (auth.status === 'signedOut') return '/sign-in';
  const { profile } = auth;
  if (profile === null) return '/loading';
  if (profile.adultConfirmedAt === null || profile.boundaryAcceptedAt === null) return '/welcome/boundary';
  if (profile.aiConsentAnsweredAt === null) return '/welcome/ai-consent';
  return '/today';
}
