import { needsAiReconsent, needsTermsConsent } from '../account/consent';
import type { Profile } from '../profile/profileRepository';

export type GateRoute =
  | '/loading'
  | '/intro'
  | '/sign-in'
  | '/welcome/boundary'
  | '/welcome/ai-consent'
  | '/welcome/triggers'
  | '/today';

/**
 * Where the account state sends the user. A signed-in user whose profile could not be read stays on
 * `/loading`: an unread profile is not an unanswered consent, so it never reaches the consent screens.
 * The setup steps start at `/welcome/triggers` and last until `complete_onboarding` stamps the profile. Terms answered
 * to an older text than this build's are asked again, onboarded or not; an older AI answer only before onboarding ends.
 */
export function nextRoute(
  auth: {
    status: 'loading' | 'signedOut' | 'signedIn';
    profile: Pick<
      Profile,
      'adultConfirmedAt' | 'boundaryAcceptedAt' | 'termsVersion' | 'aiConsentAnsweredAt' | 'aiEnabled' | 'aiConsentVersion' | 'onboardingCompletedAt'
    > | null;
  },
  device: { introSeen: boolean },
): GateRoute {
  if (auth.status === 'loading') return '/loading';
  if (auth.status === 'signedOut') return device.introSeen ? '/sign-in' : '/intro';
  const { profile } = auth;
  if (profile === null) return '/loading';
  if (profile.adultConfirmedAt === null || profile.boundaryAcceptedAt === null || needsTermsConsent(profile)) return '/welcome/boundary';
  // Onboarded users answer a newer AI text from the Companion tab instead (`aiActive`), so it never blocks Today offline.
  if (profile.aiConsentAnsweredAt === null || (profile.onboardingCompletedAt === null && needsAiReconsent(profile))) return '/welcome/ai-consent';
  if (profile.onboardingCompletedAt === null) return '/welcome/triggers';
  return '/today';
}
