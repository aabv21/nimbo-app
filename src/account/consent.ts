// The consent text versions this build shows, the privacy policy's address, and when the gate asks again.
// Versions are dates, so ISO strings compare as text (docs/architecture.md#the-consent-model).
import type { Locale } from '../i18n';
import type { Profile } from '../profile/profileRepository';

/** Must be a row of `consent_texts`; a new version is a seeded row plus this constant. */
export const TERMS_VERSION = '2026-12-01';
export const AI_CONSENT_VERSION = '2026-12-01';

export const POLICY_BASE_URL = 'https://aabv21.github.io/nimbo-privacy/';

/** The anchors every language's policy shares. */
export type PolicySection = 'ai' | 'transfers' | 'delete-your-account';

/** English is the site's root; the other languages live under their code. */
export function policyUrl(locale: Locale, section?: PolicySection): string {
  const page = locale === 'en' ? POLICY_BASE_URL : `${POLICY_BASE_URL}${locale}/`;
  return section === undefined ? page : `${page}#${section}`;
}

/** No accepted version, or one older than this build's; a newer one (accepted on a newer build) is never downgraded. */
export function needsTermsConsent(profile: Pick<Profile, 'termsVersion'>): boolean {
  return profile.termsVersion === null || profile.termsVersion < TERMS_VERSION;
}

/** Only while the AI is on: a "no" needs no new answer, since nothing is shared. */
export function needsAiReconsent(profile: Pick<Profile, 'aiEnabled' | 'aiConsentVersion'>): boolean {
  return profile.aiEnabled && (profile.aiConsentVersion === null || profile.aiConsentVersion < AI_CONSENT_VERSION);
}

/**
 * Whether AI features run on this phone: on, and answered to this build's text. A pending AI re-consent is not a gate
 * for an onboarded user (it must never lock anyone out offline); the AI stays off until the Companion tab's prompt.
 */
export function aiActive(profile: Pick<Profile, 'aiEnabled' | 'aiConsentVersion'> | null): boolean {
  return profile !== null && profile.aiEnabled && !needsAiReconsent(profile);
}
