// Descriptive counts over the user's own records: never a percentage, nothing below the pack's minimums.
import { localDateIn } from './condition/doseDays.ts';
import type { ConditionPack, DayPart, Weekday } from './condition/types.ts';
import { addDays, daysBetween, daysInMonth, localHourIn, recordDayOf, weekdayOf } from './localDays.ts';
import type { RecordEpisode, Records } from './records.ts';

export type InsightKind =
  | 'monthly_frequency'
  | 'attack_free_streak'
  | 'trigger_frequency'
  | 'time_of_day'
  | 'weekday'
  | 'helped'
  | 'sleep_before';

/** Card order, and the order of the needs. */
export const INSIGHT_KINDS: readonly InsightKind[] = Object.freeze([
  'monthly_frequency',
  'attack_free_streak',
  'trigger_frequency',
  'time_of_day',
  'weekday',
  'helped',
  'sleep_before',
] as const);

interface InsightBase<K extends InsightKind> {
  readonly kind: K;
  readonly key: string;
  readonly count: number;
  readonly of: number;
  readonly windowDays: number;
  readonly episodeIds: readonly string[];
}

export type Insight =
  | (InsightBase<'monthly_frequency'> & { readonly avgIntensity: number | null; readonly partial: boolean })
  | (InsightBase<'attack_free_streak'> & { readonly bestDays: number })
  | InsightBase<'trigger_frequency'>
  | (InsightBase<'time_of_day'> & {
      readonly buckets: Readonly<Record<DayPart, number>>;
      readonly chance: number;
      readonly pattern: boolean;
    })
  | (InsightBase<'weekday'> & {
      readonly buckets: Readonly<Record<Weekday, number>>;
      readonly chance: number;
      readonly pattern: boolean;
    })
  | (InsightBase<'helped'> & { readonly source: 'relief' | 'medication' })
  | (InsightBase<'sleep_before'> & {
      readonly baseline: { readonly count: number; readonly of: number };
      readonly avgHours: { readonly attackNights: number | null; readonly otherNights: number | null };
      readonly checkins: number;
    });

export interface InsightNeed {
  kind: InsightKind;
  unit: 'days' | 'attacks' | 'debriefs' | 'checkins' | 'recent_record';
  min: number;
  have: number;
  detail?: { shortNights: number; otherNights: number; attackDays: number };
}

export interface InsightData extends Records {
  now: Date;
  timeZone: string;
  /** Local date of the user's first record. */
  trackingSince: string;
}

const DAY_PARTS: readonly [DayPart, ...DayPart[]] = ['night', 'morning', 'afternoon', 'evening'];
const WEEKDAYS: readonly [Weekday, ...Weekday[]] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

interface Attack {
  episode: RecordEpisode;
  startDate: string;
  startHour: number;
}

interface Context {
  data: InsightData;
  pack: ConditionPack;
  today: string;
  windowStart: string;
  trackedDays: number;
  /** Every attack up to today, by start. */
  attacks: readonly Attack[];
  inWindow: readonly Attack[];
}

type Outcome = { insights: readonly Insight[] } | { need: InsightNeed };

const round = (value: number, digits: number): number => Math.round(value * 10 ** digits) / 10 ** digits;

const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

const idsOf = (attacks: readonly Attack[]): string[] => attacks.map((attack) => attack.episode.id);

function contextOf(data: InsightData, pack: ConditionPack): Context {
  const today = localDateIn(data.now, data.timeZone);
  const windowStart = addDays(today, 1 - pack.insights.windowDays);
  const attacks = data.episodes
    .map((episode) => {
      const start = new Date(episode.startedAt);
      return { episode, start: start.getTime(), startDate: localDateIn(start, data.timeZone), startHour: localHourIn(start, data.timeZone) };
    })
    .filter((attack) => attack.startDate <= today)
    .sort((a, b) => a.start - b.start)
    .map(({ episode, startDate, startHour }) => ({ episode, startDate, startHour }));
  return {
    data,
    pack,
    today,
    windowStart,
    trackedDays: Math.max(0, daysBetween(data.trackingSince, today) + 1),
    attacks,
    inWindow: attacks.filter((attack) => attack.startDate >= windowStart),
  };
}

function monthlyFrequency(ctx: Context): Outcome {
  const { minTrackedDays, months } = ctx.pack.insights.monthlyFrequency;
  if (ctx.trackedDays < minTrackedDays) {
    return { need: { kind: 'monthly_frequency', unit: 'days', min: minTrackedDays, have: ctx.trackedDays } };
  }
  const first = ctx.data.trackingSince.slice(0, 7);
  const keys: string[] = [];
  for (let month = ctx.today.slice(0, 7); month >= first && keys.length < months; month = addDays(`${month}-01`, -1).slice(0, 7)) {
    keys.unshift(month);
  }
  const insights = keys.map((key): Insight => {
    const length = daysInMonth(key);
    const from = ctx.data.trackingSince > `${key}-01` ? ctx.data.trackingSince : `${key}-01`;
    const to = ctx.today < `${key}-${String(length)}` ? ctx.today : `${key}-${String(length)}`;
    const tracked = daysBetween(from, to) + 1;
    const inMonth = ctx.attacks.filter((attack) => attack.startDate.startsWith(key));
    const intensity = mean(inMonth.flatMap((attack) => (attack.episode.intensity === null ? [] : [attack.episode.intensity])));
    return {
      kind: 'monthly_frequency',
      key,
      count: inMonth.length,
      of: tracked,
      windowDays: length,
      episodeIds: idsOf(inMonth),
      avgIntensity: intensity === null ? null : round(intensity, 1),
      partial: tracked < length,
    };
  });
  return { insights };
}

function lastRecordDate(ctx: Context): string | null {
  const { data } = ctx;
  const dates = [
    ...data.episodes.flatMap((episode) => [episode.startedAt, ...(episode.endedAt === null ? [] : [episode.endedAt])]),
    ...data.doses.map((dose) => dose.takenAt),
  ].map((instant) => localDateIn(new Date(instant), data.timeZone));
  dates.push(...data.checkins.map((checkin) => checkin.localDate));
  const past = dates.filter((date) => date <= ctx.today).sort();
  return past.at(-1) ?? null;
}

function attackFreeStreak(ctx: Context): Outcome {
  const { minTrackedDays, staleAfterDays, maxDays } = ctx.pack.insights.streak;
  if (ctx.trackedDays < minTrackedDays) {
    return { need: { kind: 'attack_free_streak', unit: 'days', min: minTrackedDays, have: ctx.trackedDays } };
  }
  // Silence is not an attack-free day: the streak needs a recent record of any kind.
  const sinceRecord = daysBetween(lastRecordDate(ctx) ?? ctx.data.trackingSince, ctx.today);
  if (sinceRecord > staleAfterDays) {
    return { need: { kind: 'attack_free_streak', unit: 'recent_record', min: staleAfterDays, have: sinceRecord } };
  }
  // Gaps run from the latest end so far, so an overlapping or out-of-order attack never opens a false one;
  // a gap that began before the horizon is clipped to it. `reach` null means an attack is still open.
  const horizon = addDays(ctx.today, -maxDays);
  let reach: string | null | undefined;
  let last: Attack | undefined;
  let bestDays = 0;
  for (const attack of ctx.attacks) {
    if (typeof reach === 'string' && attack.startDate > reach) {
      bestDays = Math.max(bestDays, daysBetween(reach > horizon ? reach : horizon, attack.startDate) - 1);
    }
    const end = attack.episode.endedAt === null ? null : localDateIn(new Date(attack.episode.endedAt), ctx.data.timeZone);
    if (reach === undefined || (reach !== null && (end === null || end >= reach))) {
      reach = end;
      last = attack;
    }
  }
  const windowDays = Math.min(ctx.trackedDays, maxDays);
  // With no attack every tracked day is attack-free; an end date after today (clock skew) reads as today.
  const days = reach === undefined ? ctx.trackedDays : reach === null ? 0 : Math.max(0, daysBetween(reach, ctx.today));
  const count = Math.min(days, windowDays);
  return {
    insights: [
      {
        kind: 'attack_free_streak',
        key: 'current',
        count,
        of: windowDays,
        windowDays,
        episodeIds: last === undefined ? [] : [last.episode.id],
        bestDays: Math.max(bestDays, count),
      },
    ],
  };
}

function triggerFrequency(ctx: Context): Outcome {
  const { minEpisodes, minCount, top } = ctx.pack.insights.triggerFrequency;
  const of = ctx.inWindow.length;
  if (of < minEpisodes) return { need: { kind: 'trigger_frequency', unit: 'attacks', min: minEpisodes, have: of } };
  const tagged = new Map<string, Attack[]>();
  for (const attack of ctx.inWindow) {
    for (const key of new Set(attack.episode.triggers)) tagged.set(key, [...(tagged.get(key) ?? []), attack]);
  }
  const insights = [...tagged]
    .filter(([, attacks]) => attacks.length >= minCount)
    .sort(([keyA, a], [keyB, b]) => b.length - a.length || (keyA < keyB ? -1 : 1))
    .slice(0, top)
    .map(([key, attacks]): Insight => ({
      kind: 'trigger_frequency',
      key,
      count: attacks.length,
      of,
      windowDays: ctx.pack.insights.windowDays,
      episodeIds: idsOf(attacks),
    }));
  return { insights };
}

/** The top bucket (the first on a tie), with the chance an even spread gives a top count that high. */
function spread<B extends string>(order: readonly [B, ...B[]], bucketOf: (attack: Attack) => B, attacks: readonly Attack[], chanceMax: number) {
  const buckets = Object.fromEntries(order.map((bucket) => [bucket, 0])) as Record<B, number>;
  for (const attack of attacks) buckets[bucketOf(attack)] += 1;
  const counts = order.map((bucket) => buckets[bucket]);
  const max = Math.max(...counts);
  const key = order[counts.indexOf(max)] ?? order[0];
  const chance = tailChance(counts);
  return {
    key,
    count: max,
    of: attacks.length,
    episodeIds: idsOf(attacks.filter((attack) => bucketOf(attack) === key)),
    buckets,
    chance: round(chance, 3),
    pattern: chance <= chanceMax,
  };
}

function timeOfDay(ctx: Context): Outcome {
  const { minEpisodes } = ctx.pack.insights.timeOfDay;
  if (ctx.inWindow.length < minEpisodes) {
    return { need: { kind: 'time_of_day', unit: 'attacks', min: minEpisodes, have: ctx.inWindow.length } };
  }
  const ranges = ctx.pack.insights.timeOfDayBuckets;
  const partOf = (attack: Attack): DayPart =>
    DAY_PARTS.find((part) => attack.startHour >= ranges[part][0] && attack.startHour < ranges[part][1]) ?? 'night';
  const result = spread(DAY_PARTS, partOf, ctx.inWindow, ctx.pack.insights.patternChanceMax);
  return { insights: [{ kind: 'time_of_day', windowDays: ctx.pack.insights.windowDays, ...result }] };
}

function weekday(ctx: Context): Outcome {
  const { minEpisodes } = ctx.pack.insights.weekday;
  if (ctx.inWindow.length < minEpisodes) {
    return { need: { kind: 'weekday', unit: 'attacks', min: minEpisodes, have: ctx.inWindow.length } };
  }
  const result = spread(WEEKDAYS, (attack) => weekdayOf(attack.startDate), ctx.inWindow, ctx.pack.insights.patternChanceMax);
  return { insights: [{ kind: 'weekday', windowDays: ctx.pack.insights.windowDays, ...result }] };
}

interface Marked {
  source: 'relief' | 'medication';
  key: string;
  count: number;
  of: number;
  episodes: Set<string>;
}

function helped(ctx: Context): Outcome {
  const { minDebriefs, minMarked, top } = ctx.pack.insights.helped;
  const debriefed = ctx.inWindow.filter((attack) => attack.episode.debriefedAt !== null);
  if (debriefed.length < minDebriefs) {
    return { need: { kind: 'helped', unit: 'debriefs', min: minDebriefs, have: debriefed.length } };
  }
  const entries = new Map<string, Marked>();
  const entry = (source: Marked['source'], key: string): Marked => {
    const id = `${source}:${key}`;
    const found = entries.get(id) ?? { source, key, count: 0, of: 0, episodes: new Set<string>() };
    entries.set(id, found);
    return found;
  };
  for (const { episode } of debriefed) {
    const yes = new Set(episode.helped);
    for (const key of new Set([...episode.helped, ...episode.didNotHelp])) {
      const marked = entry('relief', key);
      marked.of += 1;
      if (yes.has(key)) marked.count += 1;
      marked.episodes.add(episode.id);
    }
  }
  const debriefedIds = new Set(idsOf(debriefed));
  for (const dose of ctx.data.doses) {
    if (dose.helped === null || dose.episodeId === null || !debriefedIds.has(dose.episodeId)) continue;
    const marked = entry('medication', dose.medicationId);
    marked.of += 1;
    if (dose.helped) marked.count += 1;
    marked.episodes.add(dose.episodeId);
  }
  const insights = [...entries.values()]
    .filter((marked) => marked.of >= minMarked)
    .sort((a, b) => b.count * a.of - a.count * b.of || b.count - a.count || (a.key < b.key ? -1 : 1))
    .slice(0, top)
    .map((marked): Insight => ({
      kind: 'helped',
      key: marked.key,
      source: marked.source,
      count: marked.count,
      of: marked.of,
      windowDays: ctx.pack.insights.windowDays,
      episodeIds: idsOf(debriefed.filter((attack) => marked.episodes.has(attack.episode.id))),
    }));
  return { insights };
}

function sleepBefore(ctx: Context): Outcome {
  const { pack, data } = ctx;
  const rules = pack.insights.sleepBefore;
  // A night is finished once its record day is over; an attack belongs to the record day it started in.
  const recordToday = recordDayOf(data.now, data.timeZone, pack.dayStartHour);
  const attacksOn = new Map<string, Attack[]>();
  for (const attack of ctx.attacks) {
    const day = recordDayOf(new Date(attack.episode.startedAt), data.timeZone, pack.dayStartHour);
    attacksOn.set(day, [...(attacksOn.get(day) ?? []), attack]);
  }
  const nights = data.checkins.flatMap((checkin) =>
    checkin.sleepBand !== null && checkin.localDate < recordToday && checkin.localDate >= ctx.windowStart
      ? [{ band: checkin.sleepBand, attacks: attacksOn.get(checkin.localDate) ?? [] }]
      : [],
  );
  const short = nights.filter((night) => rules.shortBands.includes(night.band));
  const other = nights.filter((night) => !rules.shortBands.includes(night.band));
  const followed = (list: typeof nights) => list.filter((night) => night.attacks.length > 0);
  const attackDays = followed(nights).length;
  if (
    nights.length < rules.minCheckins ||
    short.length < rules.minShortNights ||
    other.length < rules.minOtherNights ||
    attackDays < rules.minAttackDays
  ) {
    return {
      need: {
        kind: 'sleep_before',
        unit: 'checkins',
        min: rules.minCheckins,
        have: nights.length,
        detail: { shortNights: short.length, otherNights: other.length, attackDays },
      },
    };
  }
  const hours = (list: typeof nights): number | null => {
    const value = mean(list.map((night) => pack.sleepBandHours[night.band]));
    return value === null ? null : round(value, 1);
  };
  const afterShort = new Set(followed(short).flatMap((night) => idsOf(night.attacks)));
  return {
    insights: [
      {
        kind: 'sleep_before',
        key: 'short_sleep',
        count: followed(short).length,
        of: short.length,
        windowDays: pack.insights.windowDays,
        episodeIds: idsOf(ctx.attacks.filter((attack) => afterShort.has(attack.episode.id))),
        baseline: { count: followed(other).length, of: other.length },
        avgHours: { attackNights: hours(followed(nights)), otherNights: hours(nights.filter((night) => night.attacks.length === 0)) },
        checkins: nights.length,
      },
    ],
  };
}

const RULES: Readonly<Record<InsightKind, (ctx: Context) => Outcome>> = {
  monthly_frequency: monthlyFrequency,
  attack_free_streak: attackFreeStreak,
  trigger_frequency: triggerFrequency,
  time_of_day: timeOfDay,
  weekday,
  helped,
  sleep_before: sleepBefore,
};

// One pass decides each kind, so a kind is either shown or still needed, never both.
function evaluate(data: InsightData, pack: ConditionPack): Outcome[] {
  const ctx = contextOf(data, pack);
  return INSIGHT_KINDS.map((kind) => RULES[kind](ctx));
}

export function computeInsights(data: InsightData, pack: ConditionPack): Insight[] {
  return evaluate(data, pack).flatMap((outcome) => ('insights' in outcome ? outcome.insights : []));
}

export function insightNeeds(data: InsightData, pack: ConditionPack): InsightNeed[] {
  return evaluate(data, pack).flatMap((outcome) => ('need' in outcome ? [outcome.need] : []));
}

/** Unrounded `patternChance`: 1 − (spreads with every bucket below the top count) / kⁿ, counted exactly. */
function tailChance(counts: readonly number[]): number {
  const n = counts.reduce((sum, count) => sum + count, 0);
  const k = counts.length;
  const below = Math.max(0, ...counts);
  if (n === 0 || k === 0) return 1;
  // ways[t]: ways to put t labelled items into the buckets so far, each holding fewer than `below`.
  const binomial: bigint[][] = [[1n]];
  for (let row = 1; row <= n; row += 1) {
    const previous = binomial[row - 1] ?? [];
    binomial.push(Array.from({ length: row + 1 }, (_, j) => (previous[j - 1] ?? 0n) + (previous[j] ?? 0n)));
  }
  let ways: bigint[] = Array.from({ length: n + 1 }, (_, t) => (t === 0 ? 1n : 0n));
  for (let bucket = 0; bucket < k; bucket += 1) {
    ways = ways.map((_, t) => {
      let sum = 0n;
      for (let j = 0; j < below && j <= t; j += 1) sum += (binomial[t]?.[j] ?? 0n) * (ways[t - j] ?? 0n);
      return sum;
    });
  }
  const total = BigInt(k) ** BigInt(n);
  const scale = 10n ** 15n;
  return Number(((total - (ways[n] ?? 0n)) * scale) / total) / 1e15;
}

/** P(max bucket ≥ max(counts)) for n = sum(counts) items spread evenly over counts.length buckets; exact, rounded to 3 decimals. */
export function patternChance(counts: readonly number[]): number {
  return round(tailChance(counts), 3);
}
