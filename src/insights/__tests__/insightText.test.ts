import { catalogs, translate } from '../../i18n';
import type { Locale, MessageKey, Params, PluralKey } from '../../i18n';
import { translatePlural } from '../../i18n/plural';
import type { Insight, InsightNeed } from '../index';
import { cardLines, insightLines, needLine } from '../insightText';
import type { InsightTextContext } from '../insightText';

const MED = '00000000-0000-4000-8000-000000000101';

function ctxFor(locale: Locale): InsightTextContext {
  return {
    locale,
    t: (key: MessageKey, params?: Params) => translate(locale, key, params),
    tp: (key: PluralKey, count: number, params?: Params) => translatePlural(locale, key, count, params),
    medicationName: (id) => (id === MED ? 'Sumatriptan' : null),
    today: '2026-11-27',
    trackingSince: '2026-06-10',
    attackDates: ['2026-09-01', '2026-10-15', '2026-11-02', '2026-11-20'],
  };
}
const en = ctxFor('en');

const timeOfDay = (pattern: boolean, key: 'afternoon' | 'evening'): Insight => ({
  kind: 'time_of_day',
  key,
  count: 7,
  of: 10,
  windowDays: 90,
  episodeIds: [],
  buckets: { night: 1, morning: 1, afternoon: key === 'afternoon' ? 7 : 1, evening: key === 'evening' ? 7 : 1 },
  chance: pattern ? 0.04 : 0.4,
  pattern,
});

describe('insightLines', () => {
  test('time_of_day with pattern false has no read sentence, but still its bars and basis', () => {
    const lines = insightLines(timeOfDay(false, 'afternoon'), en);
    expect(lines.read).toBeNull();
    expect(lines.bars.map((bar) => bar.label)).toEqual(['Night', 'Morning', 'Afternoon', 'Evening']);
    expect(lines.rows[2]).toBe('Afternoon, 7');
    expect(lines.basis).toBe('Based on 10 attacks since August 30.');
  });

  test('with pattern true and key evening the read is the evening sentence', () => {
    expect(insightLines(timeOfDay(true, 'evening'), en).read).toBe('Most started in the evening, between 18:00 and 00:00.');
    // The approved afternoon text, filled from the pack's hours.
    expect(insightLines(timeOfDay(true, 'afternoon'), en).read).toBe('Most started in the afternoon, between 12:00 and 18:00.');
    expect(insightLines(timeOfDay(true, 'afternoon'), ctxFor('es')).read).toBe('La mayoría empezó por la tarde, entre las 12:00 y las 18:00.');
  });

  test('a helped medication row uses the name, and the basis counts the debriefs behind it', () => {
    const medication: Insight = { kind: 'helped', key: MED, source: 'medication', count: 2, of: 3, windowDays: 90, episodeIds: ['a', 'b', 'd'] };
    const helped: Insight[] = [{ kind: 'helped', key: 'dark_room', source: 'relief', count: 3, of: 3, windowDays: 90, episodeIds: ['a', 'b', 'c'] }, medication];
    const lines = cardLines(helped, en);
    expect(lines.rows).toEqual(['Dark room, Helped 3 of 3 times', 'Sumatriptan, Helped 2 of 3 times']);
    expect(lines.rows.join(' ')).not.toContain(MED);
    expect(lines.basis).toBe('Based on 4 answered debriefs.');
    expect(insightLines({ ...medication, key: 'gone' }, en).bars).toEqual([]);
  });

  test("averages use the locale's decimal separator", () => {
    const sleep: Insight = {
      kind: 'sleep_before',
      key: 'short_sleep',
      count: 4,
      of: 6,
      windowDays: 90,
      episodeIds: [],
      baseline: { count: 2, of: 24 },
      avgHours: { attackNights: 5.5, otherNights: 7.1 },
      checkins: 30,
    };
    expect(insightLines(sleep, en).bars.map((bar) => bar.value)).toEqual(['5.5 h', '7.1 h']);
    expect(insightLines(sleep, ctxFor('es')).bars.map((bar) => bar.value)).toEqual(['5,5 h', '7,1 h']);
    expect(insightLines(sleep, en).read).toBe('Of 6 nights under 6 h, 4 were followed by an attack. Of 24 other nights, 2 were.');
    expect(insightLines(sleep, en).note).toBe(translate('en', 'insight.triggers.note'));
  });

  test('months come from Intl, with the intensity of the last two', () => {
    const month = (key: string, count: number, avgIntensity: number | null): Insight => ({
      kind: 'monthly_frequency',
      key,
      count,
      of: 30,
      windowDays: 30,
      episodeIds: [],
      avgIntensity,
      partial: false,
    });
    const lines = cardLines([month('2026-10', 7, 6.4), month('2026-11', 5, 5.8)], ctxFor('pt'));
    expect(lines.bars.map((bar) => [bar.label, bar.value])).toEqual([
      [expect.stringMatching(/^out/i) as unknown, '7'],
      [expect.stringMatching(/^nov/i) as unknown, '5'],
    ]);
    expect(lines.read).toBe('Intensidade média: 5,8 em novembro, 6,4 em outubro.');
    expect(cardLines([month('2026-10', 7, null), month('2026-11', 5, 5.8)], en).read).toBeNull();
  });

  test('the basis lines count in the plural helper', () => {
    const sleep: Insight = {
      kind: 'sleep_before',
      key: 'short_sleep',
      count: 1,
      of: 5,
      windowDays: 90,
      episodeIds: [],
      baseline: { count: 0, of: 15 },
      avgHours: { attackNights: 5.5, otherNights: 7 },
      checkins: 20,
    };
    expect(insightLines(sleep, en).basis).toBe('Based on 1 attack and 20 check-ins.');
    expect(insightLines(sleep, ctxFor('pt')).basis).toBe('Com base em 1 crise e 20 check-ins.');
    const oneCheckin: Insight = { ...sleep, count: 2, checkins: 1 };
    expect(insightLines(oneCheckin, en).basis).toBe('Based on 2 attacks and 1 check-in.');
    expect(insightLines(oneCheckin, ctxFor('es')).basis).toBe('Basado en 2 crisis y 1 check-in.');
    expect(insightLines(oneCheckin, ctxFor('pt')).basis).toBe('Com base em 2 crises e 1 check-in.');
    const helped: Insight = { kind: 'helped', key: 'dark_room', source: 'relief', count: 1, of: 2, windowDays: 90, episodeIds: ['a'] };
    expect(insightLines(helped, en).basis).toBe('Based on 1 answered debrief.');
    expect(insightLines(helped, ctxFor('es')).basis).toBe('Basado en 1 repaso respondido.');
  });

  test('the streak counts its days in the plural helper', () => {
    const streak: Insight = { kind: 'attack_free_streak', key: 'current', count: 1, of: 170, windowDays: 170, episodeIds: [], bestDays: 19 };
    const lines = insightLines(streak, en);
    expect(lines.figure).toBe('1');
    expect(lines.rows).toEqual(['1 day without an attack so far.', 'Your longest stretch in the last year: 19 days.']);
  });
});

describe('needLine', () => {
  test.each<[InsightNeed, string]>([
    [{ kind: 'monthly_frequency', unit: 'days', min: 60, have: 12 }, 'Shows up once you have two months of records. You have 12 days so far.'],
    [{ kind: 'attack_free_streak', unit: 'days', min: 14, have: 12 }, 'Shows up once you have 14 days of records. You have 12 so far.'],
    [{ kind: 'attack_free_streak', unit: 'recent_record', min: 7, have: 12 }, 'Shows up again once you log something. Your last record was 12 days ago.'],
    [{ kind: 'weekday', unit: 'attacks', min: 12, have: 2 }, 'I need at least 12 attacks to show this. You have 2 so far.'],
    [{ kind: 'helped', unit: 'debriefs', min: 3, have: 0 }, 'I need 3 answered debriefs. You have 0 so far.'],
    [{ kind: 'sleep_before', unit: 'checkins', min: 14, have: 9 }, 'I need 14 check-ins, with and without attacks, to compare. You have 9 so far.'],
  ])('%j', (need, text) => {
    expect(needLine(need, en.tp)).toBe(text);
  });

  test('a count of one takes the singular, in every language', () => {
    const firstDay: InsightNeed = { kind: 'monthly_frequency', unit: 'days', min: 60, have: 1 };
    expect(needLine(firstDay, en.tp)).toBe('Shows up once you have two months of records. You have 1 day so far.');
    expect(needLine(firstDay, ctxFor('es').tp)).toBe('Aparece cuando tengas dos meses de registros. Llevas 1 día.');
    expect(needLine({ ...firstDay, have: 30 }, ctxFor('pt').tp)).toBe('Aparece quando você tiver dois meses de registros. Até agora são 30 dias.');
    expect(needLine({ kind: 'attack_free_streak', unit: 'recent_record', min: 7, have: 1 }, ctxFor('pt').tp)).toBe(
      'Volta a aparecer quando você registrar algo. Seu último registro foi há 1 dia.',
    );
  });

  test('the attack and check-in lines agree with a have of one in es and pt', () => {
    const attacks: InsightNeed = { kind: 'weekday', unit: 'attacks', min: 12, have: 1 };
    const checkins: InsightNeed = { kind: 'sleep_before', unit: 'checkins', min: 14, have: 1 };
    expect(needLine(attacks, ctxFor('pt').tp)).toBe('Preciso de pelo menos 12 crises para mostrar isto. Até agora você tem 1.');
    expect(needLine(checkins, ctxFor('pt').tp)).toBe('Preciso de 14 check-ins, com e sem crise, para comparar. Até agora você tem 1.');
    expect(needLine(attacks, ctxFor('es').tp)).toBe('Necesito al menos 12 crisis para mostrar esto. Llevas 1.');
    expect(needLine(checkins, ctxFor('es').tp)).toBe('Necesito 14 check-ins, con y sin crisis, para comparar. Llevas 1.');
  });
});

test.each(['en', 'es', 'pt'] as const)('no %s insight string has a percentage or a prediction word', (locale) => {
  const strings = Object.entries(catalogs[locale]).filter(([key]) => key.startsWith('insight.'));
  expect(strings.length).toBeGreaterThan(40);
  for (const [, text] of strings) {
    expect(text).not.toContain('%');
    expect(text).not.toMatch(/risk|likely|predict|riesgo|probable|predec|risco|provável|prever/i);
  }
});
