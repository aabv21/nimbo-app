import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

import type { Locale } from '../condition';
import { preferenceToLocale, useLocalePreference } from './I18nProvider';
import { translatePlural } from './plural';
import type { PluralKey } from './plural';
import { translate } from './translate';
import type { MessageKey, Params } from './translate';

export type { Locale } from '../condition';
export type { PluralKey } from './plural';
export { catalogs, isMessageKey, translate } from './translate';
export type { MessageKey, Params } from './translate';

const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'es', 'pt'];

function isSupportedLocale(tag: string): tag is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(tag);
}

/** The first supported primary language (`pt-PT` counts as `pt`), else `en`. */
export function resolveLocale(languageTags: readonly string[]): Locale {
  for (const tag of languageTags) {
    const primarySubtag = tag.split('-')[0]?.toLowerCase();
    if (primarySubtag !== undefined && isSupportedLocale(primarySubtag)) {
      return primarySubtag;
    }
  }
  return 'en';
}

/** The phone's language as the app resolves it, whatever this device's stored preference says. */
export function deviceLocale(): Locale {
  return resolveLocale(getLocales().map((entry) => entry.languageTag));
}

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Params) => string;
  /** A counted message: `tp('sync.pending.count', 3)` fills `{n}` with 3 in the right plural form. */
  tp: (key: PluralKey, count: number, params?: Params) => string;
}

export type Translate = I18n['t'];
export type TranslatePlural = I18n['tp'];

export function useI18n(): I18n {
  // NOTE: reads device languages once per mount, not on an OS change; upgrade: expo-localization's `useLocales()`.
  const device = useMemo(() => deviceLocale(), []);

  // `'system'` outside an `I18nProvider` (e.g. an isolated component test), so `locale` is the device's.
  const { preference } = useLocalePreference();
  const locale = useMemo(() => preferenceToLocale(preference, device), [preference, device]);

  return useMemo(
    () => ({
      locale,
      t: (key: MessageKey, params?: Params): string => translate(locale, key, params),
      tp: (key: PluralKey, count: number, params?: Params): string => translatePlural(locale, key, count, params),
    }),
    [locale],
  );
}
