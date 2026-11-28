import { translate } from '../../i18n';
import type { MessageKey, Params, PluralKey } from '../../i18n';
import { translatePlural } from '../../i18n/plural';
import type { Signal } from '../index';
import { companionNote, noteText } from '../companionNote';

const SHORT_SLEEP: Signal = {
  kind: 'short_sleep',
  cause: 'short_sleep',
  causeKey: 'short_sleep:2026-11-27',
  evidence: { sleepBand: 'lt5', avgAttackNightHours: 5.1, attackNights: 6, avgOtherNightHours: 7.5 },
};
const PRESSURE: Signal = {
  kind: 'pressure',
  cause: 'pressure',
  causeKey: 'pressure:2026-11-27',
  evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
};

const ctx = {
  t: (key: MessageKey, params?: Params) => translate('en', key, params),
  tp: (key: PluralKey, count: number, params?: Params) => translatePlural('en', key, count, params),
  locale: 'en' as const,
  timeZone: 'America/Bogota',
};

test('an open attack gives the "during" note even with rows', () => {
  expect(companionNote({ openEpisode: true, rows: [SHORT_SLEEP, PRESSURE], hasRecords: true })).toEqual({ kind: 'during' });
});

test('with rows, the note is about the top one', () => {
  expect(companionNote({ openEpisode: false, rows: [SHORT_SLEEP, PRESSURE], hasRecords: true })).toEqual({ kind: 'signal', signal: SHORT_SLEEP });
});

test('no rows and no records give the first-day note; no rows with records give none', () => {
  expect(companionNote({ openEpisode: false, rows: [], hasRecords: false })).toEqual({ kind: 'first' });
  expect(companionNote({ openEpisode: false, rows: [], hasRecords: true })).toBeNull();
});

test('a short-night note says the band, never minutes, with its count line', () => {
  expect(noteText({ kind: 'signal', signal: SHORT_SLEEP }, ctx)).toEqual({
    text: 'You slept under 5 h last night, less than your usual on nights before an attack.',
    count: 'Average of 6 nights before an attack',
  });
});

test.each([
  ['es', 'Dormiste de 5 a 6 h anoche, por debajo de lo que sueles dormir la noche antes de una crisis.'],
  ['pt', 'Você dormiu de 5 a 6 h esta noite, abaixo do que costuma dormir na noite antes de uma crise.'],
] as const)('the %s short-night note keeps the band phrase whole', (locale, text) => {
  const signal: Signal = { ...SHORT_SLEEP, evidence: { sleepBand: '5_6', avgAttackNightHours: 6.4, attackNights: 6, avgOtherNightHours: 7.5 } };
  const local = { ...ctx, locale, t: (key: MessageKey, params?: Params) => translate(locale, key, params) };
  expect(noteText({ kind: 'signal', signal }, local).text).toBe(text);
});

test('other notes have no count line', () => {
  expect(noteText({ kind: 'signal', signal: PRESSURE }, ctx)).toEqual({ text: translate('en', 'today.note.pressure', { hpa: 6.5 }), count: null });
  expect(noteText({ kind: 'during' }, ctx).count).toBeNull();
});
