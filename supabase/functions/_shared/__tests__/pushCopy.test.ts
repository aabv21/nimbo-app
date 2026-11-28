/** @jest-environment node */
// supabase/functions/_shared/__tests__/pushCopy.test.ts
import { en } from '../../../../src/i18n/en.ts';
import { es } from '../../../../src/i18n/es.ts';
import { pt } from '../../../../src/i18n/pt.ts';
import type { Locale } from '../condition/types.ts';
import { NEUTRAL, pushLanguageOf, signalPushCopy, SLEPT, TITLES } from '../pushCopy.ts';
import type { Signal } from '../signals.ts';

const SIGNALS: readonly Signal[] = [
  { kind: 'long_attack', cause: 'long_attack:e1', causeKey: 'long_attack:e1:12', evidence: { episodeId: 'e1', hoursOpen: 15, stage: 12 } },
  { kind: 'overuse_warn', cause: 'overuse:triptan', causeKey: 'overuse:triptan:2026-11:warn', evidence: { scope: 'triptan', days: 8, limit: 10, level: 'warn' } },
  { kind: 'overuse_limit', cause: 'overuse:combined', causeKey: 'overuse:combined:2026-11:limit', evidence: { scope: 'combined', days: 10, limit: 10, level: 'limit' } },
  { kind: 'debrief_due', cause: 'debrief:e2', causeKey: 'debrief:e2', evidence: { episodeId: 'e2', endedAt: '2026-11-26T18:00:00Z' } },
  {
    kind: 'short_sleep',
    cause: 'short_sleep',
    causeKey: 'short_sleep:2026-11-27',
    evidence: { sleepBand: 'lt5', avgAttackNightHours: 5.1, attackNights: 5, avgOtherNightHours: 7.5 },
  },
  {
    kind: 'pressure',
    cause: 'pressure',
    causeKey: 'pressure:2026-11-27',
    evidence: { nowHpa: 1012.4, laterHpa: 1005.9, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
  },
  { kind: 'quiet_tracker', cause: 'quiet_tracker', causeKey: 'quiet:2026-11-23', evidence: { lastCheckinDate: '2026-11-23' } },
];

const LOCALES: readonly Locale[] = ['en', 'es', 'pt'];
const HEALTH_WORDS = /migra|attack|crisis|crise|triptan|ergot|opio|dose|dosis|sleep|sueño|sono|pressure|presión|pressão/i;
// The pack's classes (`MedicationClass`) and their words, the scope `combined`, and a medication name.
const CLASS_OR_MEDICATION = /analgesic|analg|triptan|ergot|opioid|opio|combination|combinad|combined|gepant|sumatrip/i;
const kindOf = (signal: Signal): string => signal.kind;

test('the seven kinds are all covered', () => {
  expect(new Set(SIGNALS.map(kindOf)).size).toBe(7);
});

test.each(SIGNALS.map((signal) => [signal.kind, signal] as const))('es without the opt-in, %s is exactly the neutral title', (_kind, signal) => {
  expect(signalPushCopy(signal, 'es', false)).toEqual({ title: 'Tienes una nota de Nimbo' });
});

test('without the opt-in, no kind in any language carries a health word', () => {
  for (const language of LOCALES) {
    for (const signal of SIGNALS) {
      const copy = signalPushCopy(signal, language, false);
      expect(copy).not.toHaveProperty('body');
      expect(JSON.stringify(copy)).not.toMatch(HEALTH_WORDS);
    }
  }
});

test('with the opt-in, the overuse body says the day count and never the class or a medication', () => {
  for (const language of LOCALES) {
    for (const signal of SIGNALS.filter((entry) => entry.kind === 'overuse_warn' || entry.kind === 'overuse_limit')) {
      const copy = signalPushCopy(signal, language, true);
      expect(JSON.stringify(copy)).not.toMatch(CLASS_OR_MEDICATION);
    }
  }
  expect(signalPushCopy(SIGNALS[1] as Signal, 'en', true)).toEqual({ title: 'Medication days', body: '8 of 10 days this month.' });
});

test.each([
  ['en', 'Pressure drops 6.5 hPa over the next 24 h.'],
  ['es', 'La presión baja 6,5 hPa en las próximas 24 h.'],
  ['pt', 'A pressão cai 6,5 hPa nas próximas 24 h.'],
] as const)('with the opt-in, numbers use the %s decimal separator', (language, body) => {
  expect(signalPushCopy(SIGNALS[5] as Signal, language, true).body).toBe(body);
});

test.each([
  ['long_attack', 'Long attack', 'Your attack has been going for 15 h.'],
  ['debrief_due', 'Debrief for yesterday’s attack', 'Three short questions about yesterday.'],
  ['short_sleep', 'Short night', 'You slept under 5 h, less than your average before an attack.'],
  ['quiet_tracker', 'No check-in lately', 'No check-in for 3 days.'],
] as const)('with the opt-in, %s reads its template in en', (kind, title, body) => {
  const signal = SIGNALS.find((entry) => entry.kind === kind) as Signal;
  expect(signalPushCopy(signal, 'en', true)).toEqual({ title, body });
});

test.each([
  ['en', 9, 'No check-in for 9 days.'],
  ['es', 9, 'Sin check-in desde hace 9 días.'],
  ['pt', 9, 'Sem check-in há 9 dias.'],
  ['en', 1, 'No check-in for 1 day.'],
  ['es', 1, 'Sin check-in desde hace 1 día.'],
  ['pt', 1, 'Sem check-in há 1 dia.'],
] as const)('quiet tracker in %s states the real stretch (%i days) when given', (language, days, body) => {
  const quiet = SIGNALS.find((entry) => entry.kind === 'quiet_tracker') as Signal;
  expect(signalPushCopy(quiet, language, true, { days, over: false }).body).toBe(body);
  expect(signalPushCopy(quiet, language, false, { days, over: false })).toEqual({ title: NEUTRAL[language] });
});

test.each([
  ['en', 'No check-in for over 90 days.'],
  ['es', 'Sin check-in desde hace más de 90 días.'],
  ['pt', 'Sem check-in há mais de 90 dias.'],
] as const)('a quiet stretch known only to pass the window reads "over" it in %s', (language, body) => {
  const quiet = SIGNALS.find((entry) => entry.kind === 'quiet_tracker') as Signal;
  expect(signalPushCopy(quiet, language, true, { days: 90, over: true }).body).toBe(body);
});

test('every detail body in every language is a full sentence with no placeholder left', () => {
  for (const language of LOCALES) {
    for (const signal of SIGNALS) {
      const { body } = signalPushCopy(signal, language, true);
      expect(body).toMatch(/\.$/);
      expect(body).not.toMatch(/[{}]|undefined|NaN/);
    }
  }
});

describe('parity with the app catalogs', () => {
  const catalogs = { en, es, pt } as const;

  test.each(LOCALES)('NEUTRAL.%s equals push.neutral', (language) => {
    expect(NEUTRAL[language]).toBe(catalogs[language]['push.neutral']);
  });

  test.each(LOCALES)('each %s detail title equals its signal.<kind>.title key', (language) => {
    const catalog = catalogs[language];
    expect(TITLES[language]).toEqual({
      long_attack: catalog['signal.long_attack.title'],
      overuse: catalog['signal.overuse.title'],
      debrief: catalog['signal.debrief.title'],
      short_sleep: catalog['signal.short_sleep.title'],
      pressure: catalog['signal.pressure.title'],
      quiet: catalog['signal.quiet.title'],
    });
    for (const signal of SIGNALS) expect(Object.values(TITLES[language])).toContain(signalPushCopy(signal, language, true).title);
  });

  test.each(LOCALES)('each %s sleep band phrase equals its signal.sleep.slept.<band> key', (language) => {
    const catalog = catalogs[language];
    expect(SLEPT[language]).toEqual({
      lt5: catalog['signal.sleep.slept.lt5'],
      '5_6': catalog['signal.sleep.slept.5_6'],
      '6_7': catalog['signal.sleep.slept.6_7'],
      '7_8': catalog['signal.sleep.slept.7_8'],
      gt8: catalog['signal.sleep.slept.gt8'],
    });
  });
});

test.each([
  ['fr', 'en'],
  [null, 'en'],
  [undefined, 'en'],
  [42, 'en'],
  ['es', 'es'],
  ['pt', 'pt'],
  ['en', 'en'],
] as const)('pushLanguageOf(%p) is %s', (value, language) => {
  expect(pushLanguageOf(value)).toBe(language);
});
