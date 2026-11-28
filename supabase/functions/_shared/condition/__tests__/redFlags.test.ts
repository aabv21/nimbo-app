/** @jest-environment node */
// The calibration fixtures are messages written the way people type them; a red flag must never be missed.
import { readFileSync } from 'node:fs';

import { packs } from '../index.ts';
import type { Locale, RedFlagKey } from '../index.ts';
import { matchRedFlags, matchRedFlagsAnyLocale, normalizeText } from '../redFlags.ts';

interface Fixtures {
  positives: { text: string; expect: RedFlagKey[] }[];
  negatives: { text: string }[];
  /** Messages the keywords may miss and the model screen must catch; `screen.test.ts` feeds them through a mocked Jev. */
  modelOnly: { text: string; expect: RedFlagKey[] }[];
  /** Messages mixing two languages, which only the union of the three keyword lists (what the app runs) must catch. */
  mixed: { text: string; expect: RedFlagKey[] }[];
}

const locales: readonly Locale[] = ['en', 'es', 'pt'];
const pack = packs.migraine;

function fixtures(locale: Locale): Fixtures {
  return JSON.parse(readFileSync(new URL(`../../../../../calibration/red-flags.${locale}.json`, import.meta.url), 'utf8')) as Fixtures;
}

test.each(locales)('%s positives: zero misses', (locale) => {
  const misses = fixtures(locale).positives.filter(
    ({ text, expect: keys }) => !keys.every((key) => matchRedFlags(text, locale, pack).includes(key)),
  );
  expect(misses).toEqual([]);
});

test.each(locales)('%s negatives: no hit', (locale) => {
  const hits = fixtures(locale)
    .negatives.map(({ text }) => ({ text, flags: matchRedFlags(text, locale, pack) }))
    .filter(({ flags }) => flags.length > 0);
  expect(hits).toEqual([]);
});

// The app matches the union of the three keyword lists, whatever its language.
test.each(locales)("%s positives: zero misses with every locale's keywords", (locale) => {
  const misses = fixtures(locale).positives.filter(
    ({ text, expect: keys }) => !keys.every((key) => matchRedFlagsAnyLocale(text, pack).includes(key)),
  );
  expect(misses).toEqual([]);
});

test.each(locales)("%s mixed-language positives: zero misses with every locale's keywords, and each really needs another locale", (locale) => {
  const { mixed } = fixtures(locale);
  expect(mixed.length).toBeGreaterThanOrEqual(2);
  expect(mixed.filter(({ text, expect: keys }) => !keys.every((key) => matchRedFlagsAnyLocale(text, pack).includes(key)))).toEqual([]);
  expect(mixed.filter(({ text, expect: keys }) => keys.every((key) => matchRedFlags(text, locale, pack).includes(key)))).toEqual([]);
});

test.each(locales)("%s negatives: no hit with every locale's keywords", (locale) => {
  const hits = fixtures(locale).negatives.filter(({ text }) => matchRedFlagsAnyLocale(text, pack).length > 0);
  expect(hits).toEqual([]);
});

test("the union catches a message written in another language than the app's", () => {
  expect(matchRedFlags('worst headache of my life', 'es', pack)).toEqual([]);
  expect(matchRedFlagsAnyLocale('worst headache of my life', pack)).toEqual(['thunderclap']);
  expect(matchRedFlagsAnyLocale('pior dor de cabeça, febre e pescoço duro', pack)).toEqual(['thunderclap', 'fever_stiff_neck']);
});

test('a stiff neck alone is a migraine symptom; with a fever, in any language, it is a red flag', () => {
  for (const text of ['stiff neck again', 'cuello tieso', 'pescoço duro', 'nuca dura']) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual([]);
  }
  expect(matchRedFlags('fever and my neck is stiff', 'en', pack)).toEqual(['fever_stiff_neck']);
  expect(matchRedFlags('fever and my neck is stiff', 'es', pack)).toEqual([]);
  expect(matchRedFlagsAnyLocale('tengo fever y el cuello tieso', pack)).toEqual(['fever_stiff_neck']);
  expect(matchRedFlagsAnyLocale('febre and a stiff neck', pack)).toEqual(['fever_stiff_neck']);
});

test('worse than yesterday is not the worst ever, in any language', () => {
  for (const text of ['worse than yesterday', 'peor que ayer', 'pior que ontem']) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual([]);
  }
});

test.each(locales)('%s fixtures cover every text-detectable flag at least 4 times, with 20 or more negatives', (locale) => {
  const { positives, negatives } = fixtures(locale);
  for (const flag of pack.redFlags.filter((item) => item.key !== 'long_attack')) {
    expect(positives.filter((item) => item.expect.includes(flag.key)).length).toBeGreaterThanOrEqual(4);
  }
  expect(negatives.length).toBeGreaterThanOrEqual(20);
});

test.each(locales)('%s model-only messages really miss every keyword, so they test the model layer', (locale) => {
  const { modelOnly } = fixtures(locale);
  expect(modelOnly.length).toBeGreaterThanOrEqual(3);
  expect(modelOnly.filter(({ text }) => matchRedFlagsAnyLocale(text, pack).length > 0)).toEqual([]);
  expect(modelOnly.some(({ expect: keys }) => keys.includes('fever_stiff_neck'))).toBe(true);
});

test('a fever with a severe headache is a red flag on the phone too, in any language', () => {
  for (const text of [
    'fever and a severe headache',
    'fiebre y un dolor de cabeza insoportable',
    'febre e uma dor de cabeça fortíssima',
    'fever and un dolor fortísimo',
  ]) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual(['fever_stiff_neck']);
  }
  for (const text of ['a severe headache again', 'dolor de cabeza insoportable', 'dor de cabeça forte', 'a fever last week']) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual([]);
  }
});

test("relief is not numbness: no longer feeling the pain hits nothing, while a body part that can't be felt still does", () => {
  for (const text of [
    "I can't feel the pain anymore",
    "can't feel my headache now, the triptan worked",
    'ya no siento el dolor',
    'já não sinto a dor',
    'não sinto mais a dor de cabeça',
  ]) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual([]);
  }
  for (const text of ["I can't feel my left arm", 'cant feel my hand, it started with the headache', "can't feel the left side of my face"]) {
    expect(matchRedFlagsAnyLocale(text, pack)).toEqual(['weakness']);
  }
});

test('normalizeText lower-cases, strips accents and punctuation, and collapses spaces', () => {
  expect(normalizeText('¡PEOR dolor!!  de cabeça')).toBe('peor dolor de cabeca');
  expect(normalizeText("  I can't SPEAK\n")).toBe('i can t speak');
  expect(normalizeText('Sí, señora: 39°C')).toBe('si senora 39 c');
});

test('evasion: zero-width and soft-hyphen characters inside a word, and letters spelled out one by one, still hit', () => {
  expect(matchRedFlagsAnyLocale('my face went num\u200bb', pack)).toEqual(['weakness']);
  expect(matchRedFlagsAnyLocale('worst\u00ad headache', pack)).toEqual(['thunderclap']);
  // A zero-width space between two words still separates them.
  expect(matchRedFlagsAnyLocale('worst\u200bheadache of my life', pack)).toEqual(['thunderclap']);
  expect(matchRedFlagsAnyLocale('W O R S T headache', pack)).toEqual(['thunderclap']);
  expect(matchRedFlagsAnyLocale('p-i-o-r dor', pack)).toEqual(['thunderclap']);
  expect(matchRedFlagsAnyLocale('f e v e r and s t i f f neck', pack)).toEqual(['fever_stiff_neck']);
  // A one-letter connector right before the spelled word is read both ways ("a s t i f f" is "astiff" and "a stiff").
  expect(matchRedFlagsAnyLocale('fever and a s t i f f neck', pack)).toEqual(['fever_stiff_neck']);
  expect(matchRedFlagsAnyLocale('fiebre y n u c a rigida', pack)).toEqual(['fever_stiff_neck']);
  // Two one-letter words before it, or a spelled word of two letters, are known gaps (docs/red-team.md).
  expect(matchRedFlagsAnyLocale('febre e a n u c a dura', pack)).toEqual([]);
  // Two one-letter words are ordinary text, and a spelled word must still be whole.
  expect(matchRedFlagsAnyLocale('a e dolor de siempre', pack)).toEqual([]);
  expect(matchRedFlagsAnyLocale('n u m b e r of attacks', pack)).toEqual([]);
});

test('matching is whole-phrase: a keyword inside another word does not hit', () => {
  // `parto` (giving birth) is an es pregnancy keyword; `aparto` (I move aside) only contains it.
  expect(matchRedFlags('aparto el plato', 'es', pack)).toEqual([]);
  expect(matchRedFlags('fue un parto dificil', 'es', pack)).toEqual(['pregnancy']);
  expect(matchRedFlags('fevered imagination and a stiff neck', 'en', pack)).toEqual([]);
  expect(matchRedFlags('fever and a stiff neck', 'en', pack)).toEqual(['fever_stiff_neck']);
});

test('the Review Focus sentences', () => {
  expect(matchRedFlags('PEOR dolor de cabeza de mi vida!!', 'es', pack)).toContain('thunderclap');
  expect(matchRedFlags('pior dor de cabeça da minha vida', 'pt', pack)).toContain('thunderclap');
  expect(matchRedFlags('the usual migraine, left temple, nausea', 'en', pack)).toEqual([]);
});

test('hits come back in pack order with no duplicates', () => {
  const flags = matchRedFlags('pregnant, and the worst headache of my life, worst headache ever, face numb', 'en', pack);
  expect(flags).toEqual(['thunderclap', 'weakness', 'pregnancy']);
});

test('each flag except long_attack has at least 3 keywords per locale; long_attack has none', () => {
  for (const flag of pack.redFlags) {
    for (const locale of locales) {
      if (flag.key === 'long_attack') expect(flag.keywords[locale]).toEqual([]);
      else expect(flag.keywords[locale].length).toBeGreaterThanOrEqual(3);
    }
  }
});

test('the seven flags, their why keys and a yes/no question each', () => {
  expect(pack.redFlags.map((flag) => [flag.key, flag.whyKey])).toEqual([
    ['thunderclap', 'redflag.why.thunderclap'],
    ['weakness', 'redflag.why.weakness'],
    ['fever_stiff_neck', 'redflag.why.fever'],
    ['head_injury', 'redflag.why.head_injury'],
    ['pregnancy', 'redflag.why.pregnancy'],
    ['long_aura', 'redflag.why.aura'],
    ['long_attack', 'redflag.why.long'],
  ]);
  // The model screens' state is `{ message }`, so each question names that field in backticks.
  for (const flag of pack.redFlags) expect(flag.question).toMatch(/^(Does|Is|Has|Did) .*`message`.*\?$/);
});
