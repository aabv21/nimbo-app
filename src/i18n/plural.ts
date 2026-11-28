// Counted messages: `<key>.one` / `<key>.other` (plus `.many` where CLDR has it), picked by the count.
import type { Locale } from '../condition';
import { isMessageKey, translate } from './translate';
import type { MessageKey, Params } from './translate';

/** Every base `B` such that `${B}.one` and `${B}.other` are both catalog keys. */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer B}.other` ? (`${B}.one` extends MessageKey ? B : never) : never;
}[MessageKey];

export type PluralCategory = 'one' | 'many' | 'other';

/**
 * CLDR's cardinal rules for whole counts in the three app languages, written out because Hermes has
 * no `Intl.PluralRules`. `many` is a whole million (1 000 000, 2 000 000, …) in es and pt.
 */
export function pluralCategory(locale: Locale, count: number): PluralCategory {
  const whole = Math.trunc(Math.abs(count));
  const integer = whole === Math.abs(count);
  if (locale === 'pt' ? whole <= 1 : integer && whole === 1) return 'one';
  if (locale !== 'en' && integer && whole !== 0 && whole % 1_000_000 === 0) return 'many';
  return 'other';
}

/** `{n}` is the count unless `params` sets it. */
export function translatePlural(locale: Locale, key: PluralKey, count: number, params?: Params): string {
  const form = `${key}.${pluralCategory(locale, count)}`;
  const messageKey: MessageKey = isMessageKey(form) ? form : `${key}.other`;
  return translate(locale, messageKey, { n: count, ...params });
}
