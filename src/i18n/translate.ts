// The catalogs and the lookup, apart from the hooks so `plural.ts` can use them without an import cycle.
import type { Locale } from '../condition';
import { en } from './en';
import { es } from './es';
import { pt } from './pt';

export type MessageKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;

export const catalogs: Record<Locale, Record<MessageKey, string>> = { en, es, pt };

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
