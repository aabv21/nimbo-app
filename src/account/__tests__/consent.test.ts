import { AI_CONSENT_VERSION, POLICY_BASE_URL, TERMS_VERSION, aiActive, needsAiReconsent, needsTermsConsent, policyUrl } from '../consent';

test('both versions start at the policy date', () => {
  expect(TERMS_VERSION).toBe('2026-12-01');
  expect(AI_CONSENT_VERSION).toBe('2026-12-01');
});

test.each([
  ['en', undefined, 'https://aabv21.github.io/nimbo-privacy/'],
  ['es', undefined, 'https://aabv21.github.io/nimbo-privacy/es/'],
  ['pt', undefined, 'https://aabv21.github.io/nimbo-privacy/pt/'],
  ['en', 'ai', 'https://aabv21.github.io/nimbo-privacy/#ai'],
  ['es', 'transfers', 'https://aabv21.github.io/nimbo-privacy/es/#transfers'],
  ['pt', 'delete-your-account', 'https://aabv21.github.io/nimbo-privacy/pt/#delete-your-account'],
] as const)('policyUrl(%s, %s) is %s', (locale, section, url) => {
  expect(policyUrl(locale, section)).toBe(url);
});

test('every policy URL starts at the published base', () => {
  expect(policyUrl('es', 'ai').startsWith(POLICY_BASE_URL)).toBe(true);
});

test.each([
  [null, true],
  ['2026-11-01', true],
  ['2026-12-01', false],
  // Accepted on a newer build: never downgraded.
  ['2027-01-01', false],
])('needsTermsConsent with %s is %s', (termsVersion, expected) => {
  expect(needsTermsConsent({ termsVersion })).toBe(expected);
});

test.each([
  [true, null, true],
  [true, '2026-11-01', true],
  [true, '2026-12-01', false],
  [true, '2027-01-01', false],
  [false, null, false],
  [false, '2026-11-01', false],
  [false, '2026-12-01', false],
])('needsAiReconsent with the AI %s and version %s is %s', (aiEnabled, aiConsentVersion, expected) => {
  expect(needsAiReconsent({ aiEnabled, aiConsentVersion })).toBe(expected);
});

test.each([
  [null, false],
  [{ aiEnabled: false, aiConsentVersion: '2026-12-01' }, false],
  [{ aiEnabled: true, aiConsentVersion: '2026-12-01' }, true],
  [{ aiEnabled: true, aiConsentVersion: '2027-01-01' }, true],
  // A pending re-consent turns the AI off on the phone until it is answered.
  [{ aiEnabled: true, aiConsentVersion: null }, false],
  [{ aiEnabled: true, aiConsentVersion: '2026-11-01' }, false],
])('aiActive(%j) is %s', (profile, expected) => {
  expect(aiActive(profile)).toBe(expected);
});
