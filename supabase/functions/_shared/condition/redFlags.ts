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

// Zero-width and other format characters (soft hyphen, joiners, bidi marks) and variation selectors.
const INVISIBLE = /[\p{Cf}\uFE00-\uFE0F]/gu;

/**
 * Runs of three or more one-character words joined into one: "w o r s t" (or "w-o-r-s-t") reads "worst". With
 * `keepFirst`, a run of four or more keeps its first letter apart, as the connector it may be: "y n u c a" reads "y nuca".
 */
function joinSpelled(normalized: string, keepFirst = false): string {
  const out: string[] = [];
  let run: string[] = [];
  const flush = (): void => {
    if (keepFirst && run.length >= 4) out.push(run[0] ?? '', run.slice(1).join(''));
    else if (run.length >= 3) out.push(run.join(''));
    else out.push(...run);
    run = [];
  };
  for (const word of normalized.split(' ')) {
    if (Array.from(word).length === 1) run.push(word);
    else {
      flush();
      out.push(word);
    }
  }
  flush();
  return out.join(' ');
}

/**
 * Every way `text` is read, padded: as written, with invisible characters dropped instead of splitting a word, and
 * with spelled-out letters joined (with and without a one-letter connector before them). A flag raised by any reading counts, so a reading can only add hits.
 */
function readings(text: string): string[] {
  const written = normalizeText(text);
  const joined = normalizeText(text.replace(INVISIBLE, ''));
  const spelled = [joinSpelled(written), joinSpelled(joined), joinSpelled(written, true), joinSpelled(joined, true)];
  return [...new Set([written, joined, ...spelled])].map((reading) => ` ${reading} `);
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
 * The flags whose keywords, or one phrase of every `allOf` group, appear in one reading of `text` as whole
 * phrases, in pack order and each once.
 * Negation is not parsed on purpose: "no fever" still hits, because a miss costs more than a false hit.
 */
export function matchRedFlags(text: string, locale: Locale, pack: ConditionPack): RedFlagKey[] {
  const padded = readings(text);
  return pack.redFlags.filter((flag) => padded.some((reading) => raised(flag, reading, locale))).map((flag) => flag.key);
}

/** `matchRedFlags` over every locale's keywords at once, for text whose language is not known. */
export function matchRedFlagsAnyLocale(text: string, pack: ConditionPack): RedFlagKey[] {
  const padded = readings(text);
  return pack.redFlags.filter((flag) => padded.some((reading) => raised(flag, reading, null))).map((flag) => flag.key);
}
