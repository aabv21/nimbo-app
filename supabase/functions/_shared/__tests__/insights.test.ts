/** @jest-environment node */
import { packs } from '../condition/index.ts';
import { computeInsights, insightNeeds, patternChance } from '../insights.ts';
import type { Insight, InsightData, InsightKind, InsightNeed } from '../insights.ts';
import type { RecordEpisode, Records } from '../records.ts';
import { readCases } from './cases.ts';

interface InsightCase {
  id: string;
  description: string;
  assertKinds: InsightKind[] | null;
  input: Records & { now: string; timeZone: string; trackingSince: string };
  expected: { insights: Insight[]; needs: InsightNeed[] };
}

const pack = packs.migraine;
const { cases } = readCases<InsightCase>('insights-cases.json');

const dataOf = ({ input }: InsightCase): InsightData => ({ ...input, now: new Date(input.now) });

function only<T extends { kind: InsightKind }>(items: readonly T[], kinds: readonly InsightKind[] | null): T[] {
  return items.filter((item) => kinds === null || kinds.includes(item.kind));
}

test.each(cases)('$id', (item) => {
  const data = dataOf(item);
  expect(only(computeInsights(data, pack), item.assertKinds)).toEqual(item.expected.insights);
  expect(only(insightNeeds(data, pack), item.assertKinds)).toEqual(item.expected.needs);
});

// Built records for the rules the fixtures leave open; America/Bogota is UTC−5 all year.
const NOW = new Date('2026-11-27T13:05:00Z');

function episode(id: string, startedAt: string, endedAt: string | null, patch: Partial<RecordEpisode> = {}): RecordEpisode {
  return { id, startedAt, endedAt, intensity: 5, triggers: [], helped: [], didNotHelp: [], debriefedAt: null, ...patch };
}

function data(trackingSince: string, episodes: RecordEpisode[], checkinDates: string[] = ['2026-11-27']): InsightData {
  const checkins = checkinDates.map((localDate) => ({ localDate, sleepBand: null, stress: null }));
  return { now: NOW, timeZone: 'America/Bogota', trackingSince, episodes, checkins, doses: [], medications: [] };
}

const streakOf = (input: InsightData): Insight | InsightNeed | undefined =>
  [...computeInsights(input, pack), ...insightNeeds(input, pack)].find((item) => item.kind === 'attack_free_streak');

describe('attack_free_streak', () => {
  test('the current stretch counts as the best when it is the longest', () => {
    const input = data('2026-08-01', [
      episode('e1', '2026-08-05T15:00:00Z', '2026-08-05T20:00:00Z'),
      episode('e2', '2026-08-20T15:00:00Z', '2026-08-20T20:00:00Z'),
      episode('e3', '2026-09-01T15:00:00Z', '2026-09-01T20:00:00Z'),
    ]);
    expect(streakOf(input)).toMatchObject({ count: 87, bestDays: 87, of: 119, episodeIds: ['e3'] });
  });

  test('with no attack every tracked day counts, today included', () => {
    expect(streakOf(data('2026-11-01', []))).toMatchObject({ count: 27, bestDays: 27, of: 27, episodeIds: [] });
  });

  test('an open attack leaves no current stretch, even with a closed attack inside it', () => {
    const input = data('2026-08-01', [
      episode('e1', '2026-09-01T15:00:00Z', '2026-09-01T20:00:00Z'),
      episode('e2', '2026-11-20T15:00:00Z', null),
      episode('e3', '2026-11-22T15:00:00Z', '2026-11-22T20:00:00Z'),
    ]);
    // 2026-09-02 to 2026-11-19 is the only stretch: the open e2 covers e3's end.
    expect(streakOf(input)).toMatchObject({ count: 0, bestDays: 79, episodeIds: ['e2'] });
  });

  test('a long attack overlapping a later short one measures from the latest end', () => {
    const input = data('2026-08-01', [
      episode('e1', '2026-11-01T15:00:00Z', '2026-11-10T15:00:00Z'),
      episode('e2', '2026-11-03T15:00:00Z', '2026-11-03T20:00:00Z'),
    ]);
    expect(streakOf(input)).toMatchObject({ count: 17, bestDays: 17, episodeIds: ['e1'] });
  });

  test('an end date after today (clock skew) counts zero days', () => {
    const input = data('2026-08-01', [episode('e1', '2026-11-27T12:00:00Z', '2026-11-28T06:00:00Z')]);
    expect(streakOf(input)).toMatchObject({ count: 0, bestDays: 0 });
  });

  test('count never exceeds of, and a gap that began before the horizon is clipped to it', () => {
    const input = data('2024-01-01', [
      episode('e1', '2024-06-01T15:00:00Z', '2024-06-01T20:00:00Z'),
      episode('e2', '2026-11-20T15:00:00Z', '2026-11-20T20:00:00Z'),
    ]);
    // The horizon is 2025-11-27: the days from 2025-11-28 to 2026-11-19.
    expect(streakOf(input)).toMatchObject({ count: 7, of: 365, windowDays: 365, bestDays: 357 });
    expect(streakOf(data('2024-01-01', [episode('e1', '2024-06-01T15:00:00Z', '2024-06-01T20:00:00Z')]))).toMatchObject({
      count: 365,
      of: 365,
    });
  });

  test('a record exactly staleAfterDays old still shows the streak; one day older needs a recent record', () => {
    expect(streakOf(data('2026-08-01', [], ['2026-11-20']))).toMatchObject({ kind: 'attack_free_streak', key: 'current' });
    expect(streakOf(data('2026-08-01', [], ['2026-11-19']))).toEqual({
      kind: 'attack_free_streak',
      unit: 'recent_record',
      min: 7,
      have: 8,
    });
  });
});

test('a relief marked on enough attacks is kept even when it never helped', () => {
  const debriefedAt = '2026-11-25T13:00:00Z';
  const input = data('2026-09-01', [
    episode('e1', '2026-10-02T19:00:00Z', '2026-10-03T01:00:00Z', { debriefedAt, didNotHelp: ['heat'] }),
    episode('e2', '2026-10-20T19:00:00Z', '2026-10-21T01:00:00Z', { debriefedAt, didNotHelp: ['heat'] }),
    episode('e3', '2026-11-05T19:00:00Z', '2026-11-06T01:00:00Z', { debriefedAt }),
  ]);
  expect(computeInsights(input, pack).filter((insight) => insight.kind === 'helped')).toEqual([
    { kind: 'helped', key: 'heat', source: 'relief', count: 0, of: 2, windowDays: 90, episodeIds: ['e1', 'e2'] },
  ]);
});

test('patternChance is the exact chance of a top count this high under an even spread', () => {
  expect(patternChance([1, 1, 7, 1])).toBe(0.014);
  expect(patternChance([3, 2, 2, 1])).toBeGreaterThan(0.1);
  expect(patternChance([6, 1, 1, 1, 1, 1, 1])).toBe(0.025);
  expect(patternChance([0, 0, 0, 0])).toBe(1);
});

test('no insight carries a percentage', () => {
  for (const item of cases) {
    for (const insight of computeInsights(dataOf(item), pack)) expect(JSON.stringify(insight)).not.toContain('%');
  }
});

test.each(cases)('$id: no kind is both shown and still needed', (item) => {
  const data = dataOf(item);
  const needed = new Set(insightNeeds(data, pack).map((need) => need.kind));
  expect(computeInsights(data, pack).filter((insight) => needed.has(insight.kind))).toEqual([]);
});
