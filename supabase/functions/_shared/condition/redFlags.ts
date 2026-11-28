// On-phone red-flag matching, shared with the Edge Functions: plain string work, no runtime imports.
import type { ConditionPack, Locale, RedFlag, RedFlagKey } from './types.ts';

/** Lower case, accents folded (NFD, then U+0300–U+036F dropped), anything but letters and digits as one space. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// `padded` is normalized text with a space on each side, so a keyword only hits as whole words.
function hits(padded: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => padded.includes(` ${normalizeText(keyword)} `));
}

function phrasesIn(phrases: Readonly<Record<Locale, readonly string[]>>, locale: Locale | null): readonly string[] {
  return locale === null ? Object.values(phrases).flat() : (new Map(Object.entries(phrases)).get(locale) ?? []);
}

// `locale` null is the union of the three languages: a fever term in one and a neck term in another still count.
function raised(flag: RedFlag, padded: string, locale: Locale | null): boolean {
  if (hits(padded, phrasesIn(flag.keywords, locale))) return true;
  return flag.allOf.length > 0 && flag.allOf.every((group) => hits(padded, phrasesIn(group, locale)));
}

/**
 * The flags whose keywords, or one phrase of every `allOf` group, appear in `text` as whole phrases,
 * in pack order and each once.
 * Negation is not parsed on purpose: "no fever" still hits, because a miss costs more than a false hit.
 */
export function matchRedFlags(text: string, locale: Locale, pack: ConditionPack): RedFlagKey[] {
  const padded = ` ${normalizeText(text)} `;
  return pack.redFlags.filter((flag) => raised(flag, padded, locale)).map((flag) => flag.key);
}

/** `matchRedFlags` over every locale's keywords at once, for text whose language is not known. */
export function matchRedFlagsAnyLocale(text: string, pack: ConditionPack): RedFlagKey[] {
  const padded = ` ${normalizeText(text)} `;
  return pack.redFlags.filter((flag) => raised(flag, padded, null)).map((flag) => flag.key);
}
