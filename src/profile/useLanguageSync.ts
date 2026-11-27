import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { deviceLocale, useI18n } from '../i18n';
import type { Locale } from '../i18n';
import { hasStoredPreference, useLocalePreference } from '../i18n/I18nProvider';
import { useOnResume } from '../lib/useOnResume';
import { updateProfile } from './profileRepository';

/**
 * Keeps `profile.language` on the language this phone shows (the server's own copy, for what it sends later), checked on
 * mount and on resume like `useTimezoneSync`. On a fresh install it first adopts the profile's language, once: the
 * check always stores a choice, so a later phone language is never overridden. Why: docs/architecture.md, "Design decisions".
 */
export function useLanguageSync(): void {
  const { profile, patchProfile } = useAuth();
  const { locale } = useI18n();
  const { setPreference } = useLocalePreference();
  const saved = profile?.language;
  const sending = useRef<Locale | null>(null);

  const sync = useCallback(() => {
    if (saved === undefined) return;
    if (!hasStoredPreference()) {
      const adopt = saved !== null && saved !== deviceLocale() ? saved : 'system';
      void setPreference(adopt);
      // The UI switches on the next render, where the two already match: nothing to send.
      if (adopt !== 'system') return;
    }
    if (locale === saved || locale === sending.current) return;
    sending.current = locale;
    void updateProfile({ language: locale }).then((result) => {
      // A failed save is tried again on the next resume.
      if (sending.current === locale) sending.current = null;
      if (result.ok) patchProfile({ language: result.value.language });
    });
  }, [saved, locale, setPreference, patchProfile]);

  useEffect(sync, [sync]);
  useOnResume(sync);
}
