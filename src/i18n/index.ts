import { getLocales } from 'expo-localization';
import { useMemo } from 'react';

import type { Locale } from '../../supabase/functions/_shared/condition/types.ts';
import { en } from './en';
import { es } from './es';
import { preferenceToLocale, useLocalePreference } from './I18nProvider';
import { pt } from './pt';

export type { Locale } from '../../supabase/functions/_shared/condition/types.ts';
export type MessageKey = keyof typeof en;
type Params = Readonly<Record<string, string | number>>;

export const catalogs: Record<Locale, Record<MessageKey, string>> = { en, es, pt };

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

const numberFormats = new Map<Locale, Intl.NumberFormat>();

function numberFormat(locale: Locale): Intl.NumberFormat {
  let format = numberFormats.get(locale);
  if (format === undefined) {
    format = new Intl.NumberFormat(locale);
    numberFormats.set(locale, format);
  }
  return format;
}

/** Whether `key` is a catalog key, e.g. a label key carried by the condition pack. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key);
}

function catalogFor(locale: Locale): Record<MessageKey, string> {
  switch (locale) {
    case 'es':
      return es;
    case 'pt':
      return pt;
    case 'en':
      return en;
  }
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = new Map(Object.entries(catalogFor(locale))).get(key) ?? key;
  if (params === undefined) {
    return template;
  }
  const values = new Map(Object.entries(params));
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values.get(name);
    if (value === undefined) {
      return match;
    }
    return typeof value === 'number' ? numberFormat(locale).format(value) : value;
  });
}

export function useI18n(): { locale: Locale; t: (key: MessageKey, params?: Params) => string } {
  // NOTE: reads device languages once per mount, not on an OS change; upgrade: expo-localization's `useLocales()`.
  const deviceLocale = useMemo(() => resolveLocale(getLocales().map((entry) => entry.languageTag)), []);

  // `'system'` outside an `I18nProvider` (e.g. an isolated component test), so `locale` is `deviceLocale`.
  const { preference } = useLocalePreference();
  const locale = useMemo(() => preferenceToLocale(preference, deviceLocale), [preference, deviceLocale]);

  const t = useMemo(() => (key: MessageKey, params?: Params): string => translate(locale, key, params), [locale]);

  return { locale, t };
}
