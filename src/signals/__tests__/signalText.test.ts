import { catalogs, translate } from '../../i18n';
import type { Locale, MessageKey, Params, PluralKey } from '../../i18n';
import { translatePlural } from '../../i18n/plural';
import type { Signal } from '../index';
import { signalText } from '../signalText';

const tFor =
  (locale: Locale) =>
  (key: MessageKey, params?: Params): string =>
    translate(locale, key, params);
const tpFor =
  (locale: Locale) =>
  (key: PluralKey, count: number, params?: Params): string =>
    translatePlural(locale, key, count, params);
const ctx = (locale: Locale, knownTriggers: readonly string[] = []) => ({ t: tFor(locale), tp: tpFor(locale), locale, knownTriggers, timeZone: 'America/Bogota' });

const PRESSURE: Signal = {
  kind: 'pressure',
  cause: 'pressure',
  causeKey: 'pressure:2026-11-27',
  evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
};
const shortSleep = (attackNights: number): Signal => ({
  kind: 'short_sleep',
  cause: 'short_sleep',
  causeKey: 'short_sleep:2026-11-27',
  evidence: { sleepBand: 'lt5', avgAttackNightHours: 5.1, attackNights, avgOtherNightHours: 7.5 },
});
const SHORT_SLEEP = shortSleep(6);
const DEBRIEF: Signal = { kind: 'debrief_due', cause: 'debrief:e1', causeKey: 'debrief:e1', evidence: { episodeId: 'e1', endedAt: '2026-11-26T23:40:00Z' } };
const OTHERS: Signal[] = [
  { kind: 'overuse_warn', cause: 'overuse:triptan', causeKey: 'overuse:triptan:warn:2026-11', evidence: { scope: 'triptan', days: 8, limit: 10, level: 'warn' } },
  { kind: 'overuse_limit', cause: 'overuse:combined', causeKey: 'overuse:combined:limit:2026-11', evidence: { scope: 'combined', days: 10, limit: 10, level: 'limit' } },
  { kind: 'long_attack', cause: 'long_attack:e2', causeKey: 'long_attack:e2:12', evidence: { episodeId: 'e2', hoursOpen: 13, stage: 12 } },
  { kind: 'quiet_tracker', cause: 'quiet_tracker', causeKey: 'quiet:2026-11-23', evidence: { lastCheckinDate: '2026-11-23' } },
];

test('pressure uses the approved reason when weather is a chosen trigger, else the tagged one', () => {
  expect(signalText(PRESSURE, ctx('en', ['weather'])).reason).toBe(translate('en', 'signal.pressure.reason', { hpa: 6.5 }));
  expect(signalText(PRESSURE, ctx('en')).reason).toBe(translate('en', 'signal.pressure.reason_tagged', { hpa: 6.5 }));
});

test('the pressure detail keeps four-digit values whole and gives the time in the zone', () => {
  // 13:00 UTC is 8:00 in Bogotá.
  expect(signalText(PRESSURE, ctx('en')).detail).toBe('Forecast for your area: 1012 hPa now, 1006 hPa tomorrow at 8:00 AM.');
});

test('short sleep says the band and the average in hours, with the locale separator', () => {
  const en = signalText(SHORT_SLEEP, ctx('en'));
  expect(en.reason).toBe('You slept under 5 h, under your average before an attack.');
  expect(en.detail).toBe('Your average on nights before an attack: 5.1 h, over 6 nights.');
  expect(signalText(SHORT_SLEEP, ctx('es')).detail).toBe('Tu media en las noches antes de una crisis: 5,1 h, en 6 noches.');
  expect(signalText(SHORT_SLEEP, ctx('pt')).reason).toContain('Você dormiu menos de 5 h');
});

test('the short-sleep detail counts nights, singular for one', () => {
  const one = shortSleep(1);
  expect(signalText(one, ctx('en')).detail).toBe('Your average on nights before an attack: 5.1 h, over 1 night.');
  expect(signalText(one, ctx('es')).detail).toBe('Tu media en las noches antes de una crisis: 5,1 h, en 1 noche.');
  expect(signalText(one, ctx('pt')).detail).toBe('Sua média nas noites antes de uma crise: 5,1 h, em 1 noite.');
  expect(signalText(SHORT_SLEEP, ctx('pt')).detail).toBe('Sua média nas noites antes de uma crise: 5,1 h, em 6 noites.');
});

test('each kind leads to its action', () => {
  expect(signalText(DEBRIEF, ctx('en')).action).toEqual({ label: translate('en', 'signal.debrief.action'), kind: 'debrief' });
  expect(OTHERS.map((signal) => signalText(signal, ctx('en')).action?.kind)).toEqual(['cabinet', 'cabinet', 'crisis', 'checkin']);
  expect(signalText(PRESSURE, ctx('en')).action).toBeNull();
  expect(signalText(SHORT_SLEEP, ctx('en')).action).toBeNull();
});

test('only pressure carries the weather attribution', () => {
  for (const signal of [SHORT_SLEEP, DEBRIEF, ...OTHERS]) expect(signalText(signal, ctx('en')).attribution).toBe(false);
  expect(signalText(PRESSURE, ctx('en')).attribution).toBe(true);
});

test('no signal, note or push string in any locale has a percentage or speaks of risk or prediction', () => {
  const banned = /risk|likely|predict|forecast of an attack|riesgo|probable|risco|provável/i;
  for (const catalog of Object.values(catalogs)) {
    const strings = Object.entries(catalog).filter(([key]) => /^(signal|today\.note|push)\./.test(key));
    expect(strings.length).toBeGreaterThan(40);
    for (const [key, text] of strings) {
      expect({ key, percent: text.includes('%') }).toEqual({ key, percent: false });
      expect({ key, banned: banned.test(text) }).toEqual({ key, banned: false });
    }
  }
});
