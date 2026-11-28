// The words of each insight card, chosen here so they are testable without rendering. Counts only: no
// percentage, and a pattern sentence only when the spread stands out from chance.
import { packs } from '../condition';
import type { DayPart, Weekday } from '../condition';
import { isMessageKey } from '../i18n';
import type { Locale, MessageKey, Translate, TranslatePlural } from '../i18n';
import type { Insight, InsightKind, InsightNeed } from './index';

/** One labelled bar: `fraction` (0–1) sets its length, `value` is the text beside it. */
export interface Bar {
  label: string;
  value: string;
  fraction: number;
}

export interface InsightLines {
  title: string;
  /** A large figure above the rows (the current stretch), or null. */
  figure: string | null;
  bars: Bar[];
  /** Each bar as one line to read aloud, then the card's plain lines. */
  rows: string[];
  read: string | null;
  /** A caution under the card (co-occurrence is not cause), or null. */
  note: string | null;
  basis: string;
}

export interface InsightTextContext {
  locale: Locale;
  t: Translate;
  tp: TranslatePlural;
  medicationName: (id: string) => string | null;
  /** The local day, the first tracked day, and the local start date of every attack, for the basis lines. */
  today: string;
  trackingSince: string;
  attackDates: readonly string[];
}

const pack = packs.migraine;
const DAY_PARTS: readonly DayPart[] = ['night', 'morning', 'afternoon', 'evening'];
const WEEKDAYS: readonly Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TITLES: Readonly<Record<InsightKind, MessageKey>> = {
  monthly_frequency: 'insight.frequency.title',
  attack_free_streak: 'insight.streak.title',
  trigger_frequency: 'insight.triggers.title',
  time_of_day: 'insight.time.title',
  weekday: 'insight.weekday.title',
  helped: 'insight.helped.title',
  sleep_before: 'insight.sleep.title',
};

export function insightTitle(kind: InsightKind, t: Translate): string {
  return t(TITLES[kind]);
}

const formats = new Map<string, Intl.DateTimeFormat>();

function dateText(localDate: string, locale: Locale, options: Intl.DateTimeFormatOptions): string {
  const id = `${locale}:${JSON.stringify(options)}`;
  let format = formats.get(id);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formats.set(id, format);
  }
  return format.format(new Date(`${localDate}T12:00:00Z`));
}

const monthShort = (month: string, locale: Locale): string => dateText(`${month}-01`, locale, { month: 'short' });
const monthLong = (month: string, locale: Locale): string => dateText(`${month}-01`, locale, { month: 'long' });
const dayLong = (localDate: string, locale: Locale): string => dateText(localDate, locale, { month: 'long', day: 'numeric' });

const addDays = (localDate: string, days: number): string =>
  new Date(Date.parse(`${localDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A clock hour as the approved copy writes it in every language ("12:00", "18:00"). */
const hourText = (hour: number): string => `${String(hour % 24).padStart(2, '0')}:00`;

const labelOf = (t: Translate, key: string): string => (isMessageKey(key) ? t(key) : key);

/** Bars whose lengths follow the largest count. */
function countBars(entries: readonly { label: string; count: number }[]): Bar[] {
  const max = Math.max(1, ...entries.map((entry) => entry.count));
  return entries.map((entry) => ({ label: entry.label, value: String(entry.count), fraction: entry.count / max }));
}

/** "Based on N attacks since …": the attacks that started from `since` to today. */
function attacksSince(since: string, ctx: InsightTextContext, label: string): string {
  const n = ctx.attackDates.filter((date) => date >= since && date <= ctx.today).length;
  return ctx.tp('insight.rests', n, { since: label });
}

function windowSince(windowDays: number, ctx: InsightTextContext): string {
  const start = addDays(ctx.today, 1 - windowDays);
  return start > ctx.trackingSince ? start : ctx.trackingSince;
}

const empty = (title: string, basis: string): InsightLines => ({ title, figure: null, bars: [], rows: [], read: null, note: null, basis });

/** The lines of one kind's card, from that kind's insights in computed order. */
export function cardLines(insights: readonly Insight[], ctx: InsightTextContext): InsightLines {
  const { t, tp, locale } = ctx;
  const [first] = insights;
  if (first === undefined) throw new RangeError('A card needs at least one insight.');
  const title = insightTitle(first.kind, t);
  const withRows = (lines: InsightLines): InsightLines => ({ ...lines, rows: [...lines.bars.map((bar) => `${bar.label}, ${bar.value}`), ...lines.rows] });

  switch (first.kind) {
    case 'monthly_frequency': {
      const months = insights.flatMap((insight) => (insight.kind === 'monthly_frequency' ? [insight] : []));
      const [latest, previous] = [months.at(-1), months.at(-2)];
      const [avg, prev] = [latest?.avgIntensity ?? null, previous?.avgIntensity ?? null];
      const read =
        latest !== undefined && previous !== undefined && avg !== null && prev !== null
          ? t('insight.frequency.intensity', { avg, month: monthLong(latest.key, locale), prev, prevMonth: monthLong(previous.key, locale) })
          : null;
      const since = `${first.key}-01` > ctx.trackingSince ? `${first.key}-01` : ctx.trackingSince;
      return withRows({
        ...empty(title, attacksSince(since, ctx, monthLong(first.key, locale))),
        bars: countBars(months.map((month) => ({ label: monthShort(month.key, locale), count: month.count }))),
        read,
      });
    }
    case 'attack_free_streak': {
      const since = windowSince(first.windowDays, ctx);
      return {
        ...empty(title, attacksSince(since, ctx, dayLong(since, locale))),
        figure: String(first.count),
        rows: [tp('insight.streak.current', first.count), ...(first.bestDays > 0 ? [tp('insight.streak.best', first.bestDays, { best: first.bestDays })] : [])],
      };
    }
    case 'trigger_frequency': {
      const since = windowSince(first.windowDays, ctx);
      return withRows({
        ...empty(title, ctx.tp('insight.rests', first.of, { since: dayLong(since, locale) })),
        bars: insights.map((insight) => ({
          label: labelOf(t, `condition.triggers.${insight.key}`),
          value: t('insight.of_attacks', { n: insight.count, of: insight.of }),
          fraction: insight.of === 0 ? 0 : insight.count / insight.of,
        })),
        note: t('insight.triggers.note'),
      });
    }
    case 'time_of_day': {
      const since = windowSince(first.windowDays, ctx);
      const [from, to] = pack.insights.timeOfDayBuckets[first.key as DayPart];
      return withRows({
        ...empty(title, ctx.tp('insight.rests', first.of, { since: dayLong(since, locale) })),
        bars: countBars(DAY_PARTS.map((part) => ({ label: t(`insight.t.${part}`), count: first.buckets[part] }))),
        read: first.pattern ? t(`insight.time.read.${first.key as DayPart}`, { from: hourText(from), to: hourText(to) }) : null,
      });
    }
    case 'weekday': {
      const since = windowSince(first.windowDays, ctx);
      return withRows({
        ...empty(title, ctx.tp('insight.rests', first.of, { since: dayLong(since, locale) })),
        bars: countBars(WEEKDAYS.map((day) => ({ label: t(`history.dow.${day}`), count: first.buckets[day] }))),
        read: first.pattern ? t(`insight.weekday.read.${first.key as Weekday}`) : null,
      });
    }
    case 'helped': {
      const entries = insights.flatMap((insight) => {
        if (insight.kind !== 'helped') return [];
        const label = insight.source === 'relief' ? labelOf(t, `condition.reliefs.${insight.key}`) : ctx.medicationName(insight.key);
        return label === null ? [] : [{ insight, label }];
      });
      const debriefs = new Set(entries.flatMap(({ insight }) => insight.episodeIds)).size;
      return withRows({
        ...empty(title, tp('insight.rests_debriefs', debriefs)),
        bars: entries.map(({ insight, label }) => ({
          label,
          value: t('insight.helped.row', { n: insight.count, of: insight.of }),
          fraction: insight.of === 0 ? 0 : insight.count / insight.of,
        })),
      });
    }
    case 'sleep_before': {
      const nights = [
        { label: t('insight.sleep.before'), hours: first.avgHours.attackNights },
        { label: t('insight.sleep.other'), hours: first.avgHours.otherNights },
      ];
      const max = Math.max(1, ...nights.map((night) => night.hours ?? 0));
      return withRows({
        ...empty(title, tp('insight.rests_checkins', first.count + first.baseline.count, { c: first.checkins })),
        bars: nights.flatMap((night) => (night.hours === null ? [] : [{ label: night.label, value: t('insight.sleep.hours', { h: night.hours }), fraction: night.hours / max }])),
        read: t('insight.sleep.read', { short: first.of, count: first.count, other: first.baseline.of, base: first.baseline.count }),
        note: t('insight.triggers.note'),
      });
    }
  }
}

/** One insight's lines; a kind with several insights (months, triggers, what helped) renders them with `cardLines`. */
export function insightLines(insight: Insight, ctx: InsightTextContext): InsightLines {
  return cardLines([insight], ctx);
}

/** What a kind still needs, never a number of its own; the noun follows the count it belongs to. */
export function needLine(need: InsightNeed, tp: TranslatePlural): string {
  const { min, have } = need;
  switch (need.unit) {
    case 'days':
      return need.kind === 'monthly_frequency' ? tp('insight.need.months', have, { days: have }) : tp('insight.need.days', min, { min, have });
    case 'attacks':
      return tp('insight.need.attacks', min, { min, have });
    case 'debriefs':
      return tp('insight.need.debriefs', min, { min, have });
    case 'checkins':
      return tp('insight.need.checkins', min, { min, have });
    case 'recent_record':
      return tp('insight.need.recent', have, { have });
  }
}
