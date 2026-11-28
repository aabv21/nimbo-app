// The companion's ten tools, run on the server with the caller's token. Results carry catalog keys, local
// times and short refs, never ids; every input is checked again here, whatever `strict` promised.

import {
  type CatalogName,
  catalogKeys,
  type ConditionPack,
  crisisPlan,
  doseDaysForMonth,
  localDateIn,
  MAX_AHEAD_MS,
  type MedicationClass,
  overuseStatus,
  packs,
} from '../condition/index.ts';
import { isRecord, UUID } from '../guards.ts';
import { computeInsights, type Insight, INSIGHT_KINDS, insightNeeds } from '../insights.ts';
import { INSIGHT_SINCE_DAYS, parseRecordInputs, trackingSinceOf } from '../records.ts';
import { rpcClient } from '../rest.ts';
import { type CheckinDraft, type Draft, type DoseDraft, type EpisodeDraft, type Evidence, isLocalDate, NOTE_MAX_CHARS } from './contract.ts';
import { addDays, type Caller, type EpisodeSpan, localIso, parseZonedTime, readCountedRows, readRows, type Row, zonedMidnight, zoneOrUtc } from './data.ts';
import type { RefPrefix, Refs } from './refs.ts';
import { spaceInvisible, type ToolCall } from './turns.ts';

const MAX_DRAFTS = 3;
const EPISODES_DEFAULT_LIMIT = 10;
const EPISODES_MAX_LIMIT = 20;
const DEFAULT_WINDOW_DAYS = 90;
/** A check-in draft may be for any of the 7 days up to the request's day. */
const CHECKIN_WINDOW_DAYS = 7;
const PLAN_ENTRIES = 5;
// Bounds on what one result puts in the prompt; a cut result says `truncated: true`.
const MAX_CABINET_MEDICATIONS = 30;
const MAX_DOSES_PER_EPISODE = 10;
const NAME_MAX_CHARS = 80;
const DOSE_TEXT_MAX_CHARS = 120;
const FUTURE_SLACK_MS = MAX_AHEAD_MS;
/**
 * PostgREST's `max_rows` (supabase/config.toml), named on the reads that have no smaller bound so that, with an
 * explicit order, a cut always drops the same end (the oldest) rather than whichever rows came last.
 */
const READ_ROWS = 1000;
const EARLIEST = Date.UTC(2000, 0, 1);
const SLEEP_BANDS = ['lt5', '5_6', '6_7', '7_8', 'gt8'] as const;
const SLEEP_QUALITIES = ['bad', 'ok', 'good'] as const;
const STRESS_LEVELS = ['low', 'mid', 'high'] as const;
const DAY_MS = 86_400_000;

// --- Definitions --------------------------------------------------------------------------------

type Schema = Record<string, unknown>;
export type ToolDefinition = {
  name: string;
  description: string;
  strict: true;
  input_schema: { type: 'object'; additionalProperties: false; properties: Record<string, Schema>; required: string[] };
};

const sorted = (values: readonly string[]): string[] => [...values].sort();
const text = (description: string, format?: 'date' | 'date-time'): Schema => ({ type: 'string', ...(format === undefined ? {} : { format }), description });
const choice = (values: readonly string[], description: string): Schema => ({ type: 'string', enum: sorted(values), description });
const keys = (catalog: CatalogName, description: string): Schema => ({
  type: 'array',
  items: { type: 'string', enum: sorted(catalogKeys(packs.migraine, catalog)) },
  description,
});
const flag = (description: string): Schema => ({ type: 'boolean', description });

function tool(name: string, description: string, properties: Record<string, Schema> = {}, required: string[] = []): ToolDefinition {
  return { name, description, strict: true, input_schema: { type: 'object', additionalProperties: false, properties, required } };
}

const TIME = 'ISO 8601 with the person’s UTC offset, for example 2026-03-14T08:30:00-05:00.';

/** Fixed order and wording: they sit at the start of the cached prefix, so any change re-writes the cache once. */
export const COMPANION_TOOLS: readonly ToolDefinition[] = Object.freeze([
  tool(
    'get_episodes',
    'Lists the person’s attacks that started in a window of their local dates, newest first: start and end, intensity (0–10), pain areas, symptoms, triggers, reliefs, what helped and what did not, and the doses taken during each. Without dates it covers the last 90 days. Cite result_ref for counts of these attacks; total is how many started in the window.',
    {
      from: text('First local date of the window, YYYY-MM-DD.', 'date'),
      to: text('Last local date of the window, YYYY-MM-DD; today if left out.', 'date'),
      limit: { type: 'integer', description: 'How many attacks to return, 1 to 20; 10 if left out.' },
    },
  ),
  tool(
    'get_insights',
    'Patterns the app computed from the person’s own records: attacks per month, days without an attack, their most tagged triggers, time of day, day of the week, what helped in debriefed attacks, and sleep the night before. Each gives count out of of, window_days and a ref to cite; pattern says whether a time or weekday spread stands out from chance. needs lists the patterns that still need more records, with how many they need and have.',
    { kind: choice(INSIGHT_KINDS, 'Only this kind of pattern; all kinds if left out.') },
  ),
  tool(
    'get_cabinet',
    'Lists the person’s active medications (name, kind, class, form, the dose text they saved themselves, and whether they set a minimum interval) and this calendar month’s overuse counts: days with an acute dose per class and for the classes combined, each against its limit, with a ref to cite.',
  ),
  tool('get_signals', 'Today’s signals and their reasons.'),
  tool(
    'get_crisis_plan',
    'What helped the person in attacks they debriefed: comfort measures and their own medications, best first, at most five, each with how many times it helped out of how many tries and a ref to cite.',
  ),
  tool(
    'propose_episode',
    `Makes a draft attack the person confirms in the app; nothing is saved. With episode_ref it updates, ends or debriefs that attack (the open one included); without it the draft is a new attack and needs started_at, and ended_at too while another attack is open. Include only what the person said. Times: ${TIME}`,
    {
      episode_ref: text('The ref of an attack from get_episodes or the second system block.'),
      started_at: text('When the attack started.', 'date-time'),
      ended_at: text('When the attack ended.', 'date-time'),
      intensity: { type: 'integer', description: 'Pain from 0 (none) to 10 (worst).' },
      pain_areas: keys('painAreas', 'Where it hurts.'),
      symptoms: keys('symptoms', 'Symptoms they named.'),
      triggers: keys('triggers', 'What they think set it off.'),
      reliefs: keys('reliefs', 'What they tried during the attack.'),
      helped: keys('reliefs', 'What they say helped (a debrief).'),
      did_not_help: keys('reliefs', 'What they say did not help (a debrief).'),
      doses: {
        type: 'array',
        description: 'Doses they took during this attack.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            medication_ref: text('The ref of the medication from get_cabinet or get_episodes.'),
            taken_at: text('When they took it.', 'date-time'),
          },
          required: ['medication_ref', 'taken_at'],
        },
      },
    },
  ),
  tool(
    'propose_dose',
    `Makes a draft dose the person confirms in the app; nothing is saved. Use it for a dose outside an attack report, or linked to an attack with episode_ref. Times: ${TIME}`,
    {
      medication_ref: text('The ref of the medication from get_cabinet or get_episodes.'),
      taken_at: text('When they took it.', 'date-time'),
      episode_ref: text('The ref of the attack it was taken for, if any.'),
    },
    ['medication_ref', 'taken_at'],
  ),
  tool(
    'propose_checkin',
    'Makes a draft daily check-in the person confirms in the app; nothing is saved. local_date is one of the last 7 days. Include only what the person said.',
    {
      local_date: text('The day it describes, YYYY-MM-DD.', 'date'),
      sleep_band: choice(SLEEP_BANDS, 'Hours slept: under 5, 5–6, 6–7, 7–8 or over 8.'),
      sleep_quality: choice(SLEEP_QUALITIES, 'How well they slept.'),
      stress: choice(STRESS_LEVELS, 'Their stress that day.'),
      low_water: flag('They drank little water.'),
      extra_caffeine: flag('They had more caffeine than usual.'),
      alcohol: flag('They drank alcohol.'),
      skipped_meal: flag('They skipped a meal.'),
      screen_heavy: flag('They spent long hours at screens.'),
    },
    ['local_date'],
  ),
  tool(
    'save_note',
    'Saves a short note, up to 200 characters, about how the person likes things, for later conversations. Never health details. They can see and delete every note; there are at most 20.',
    { text: text('The note, in the person’s language.') },
    ['text'],
  ),
  tool('forget_note', 'Deletes one of the person’s notes.', { note_ref: text('The ref of the note from the notes block or save_note.') }, ['note_ref']),
]);

// --- Running them -------------------------------------------------------------------------------

/** Per request: how many drafts were made, and the stored start and end of every attack the model has a ref for. */
export type ToolState = { drafts: number; spans: Map<string, { start: number; end: number | null }> };

export type ToolEnv = Caller & {
  /** The caller's own id, for the RPCs that take it; RLS still limits every read to their rows. */
  userId: string;
  pack: ConditionPack;
  refs: Refs;
  timeZone: string;
  /** The request's day, YYYY-MM-DD. */
  localDate: string;
  now: () => number;
  openEpisode: EpisodeSpan | null;
  state: ToolState;
};

/** `draft` and `evidence` stay on the server: only `content` goes to the model. */
export type ToolOutcome = { content: unknown; isError: boolean; draft?: Draft; evidence?: Evidence[] };

/** An input the model can correct: the reason word (and any hint) goes back as an `is_error` result. */
class Invalid extends Error {
  readonly reason: string;
  readonly hint: Record<string, unknown>;
  constructor(reason: string, hint: Record<string, unknown> = {}) {
    super(reason);
    this.reason = reason;
    this.hint = hint;
  }
}

const absent = (value: unknown): value is null | undefined => value === undefined || value === null;

function refId(env: ToolEnv, prefix: RefPrefix, value: unknown): string {
  const id = typeof value === 'string' && value.startsWith(prefix) ? env.refs.idOf(value) : null;
  if (id === null) throw new Invalid('unknown_ref');
  return id;
}

function timeOf(env: ToolEnv, value: unknown): number {
  const time = parseZonedTime(value);
  if (time === null) throw new Invalid('invalid_time');
  if (time < EARLIEST) throw new Invalid('time_too_early');
  if (time > env.now() + FUTURE_SLACK_MS) throw new Invalid('time_in_future');
  return time;
}

const optionalTime = (env: ToolEnv, value: unknown): number | null => (absent(value) ? null : timeOf(env, value));

function keyList(env: ToolEnv, catalog: CatalogName, value: unknown): string[] {
  if (absent(value)) return [];
  const allowed = catalogKeys(env.pack, catalog);
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && allowed.includes(item))) throw new Invalid('unknown_key');
  return [...new Set(value as string[])];
}

function optionalOf<T extends string>(options: readonly T[], value: unknown): T | null {
  if (absent(value)) return null;
  const found = options.find((option) => option === value);
  if (found === undefined) throw new Invalid('invalid_value');
  return found;
}

function optionalBoolean(value: unknown): boolean | null {
  if (absent(value)) return null;
  if (typeof value !== 'boolean') throw new Invalid('invalid_value');
  return value;
}

function optionalDate(value: unknown): string | null {
  if (absent(value)) return null;
  if (!isLocalDate(value)) throw new Invalid('invalid_date');
  return value;
}

function claimDraft(env: ToolEnv): void {
  if (env.state.drafts >= MAX_DRAFTS) throw new Invalid('draft_limit');
  env.state.drafts += 1;
}

const iso = (time: number | null): string | null => (time === null ? null : new Date(time).toISOString());
const local = (env: ToolEnv, time: number | null): string | null => (time === null ? null : localIso(time, env.timeZone));
const stringsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const textUpTo = (value: unknown, max: number): string | null => (typeof value === 'string' && Array.from(value).length <= max ? value : null);
const zonedIso = (env: ToolEnv, value: unknown): string | null => (typeof value === 'string' ? localIso(Date.parse(value), env.timeZone) : null);

async function getEpisodes(call: ToolCall, input: Record<string, unknown>, env: ToolEnv): Promise<ToolOutcome> {
  const from = optionalDate(input.from);
  const to = optionalDate(input.to) ?? env.localDate;
  const start = from ?? addDays(to, 1 - DEFAULT_WINDOW_DAYS);
  if (start > to) throw new Invalid('invalid_date');
  let limit = EPISODES_DEFAULT_LIMIT;
  if (!absent(input.limit)) {
    if (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > EPISODES_MAX_LIMIT) {
      throw new Invalid('invalid_limit');
    }
    limit = input.limit;
  }
  const { rows, total } = await readCountedRows(env, 'episodes', [
    ['select', 'id,started_at,ended_at,intensity,pain_areas,symptoms,triggers,reliefs,helped,did_not_help'],
    ['started_at', `gte.${new Date(zonedMidnight(start, env.timeZone)).toISOString()}`],
    ['started_at', `lt.${new Date(zonedMidnight(addDays(to, 1), env.timeZone)).toISOString()}`],
    ['order', 'started_at.desc'],
    ['limit', String(limit)],
  ]);
  const ids = rows.flatMap((row) => (typeof row.id === 'string' && UUID.test(row.id) ? [row.id] : []));
  const doses =
    ids.length === 0
      ? []
      : await readRows(env, 'doses', [
          ['select', 'episode_id,medication_id,taken_at'],
          ['episode_id', `in.(${ids.join(',')})`],
          ['order', 'taken_at.asc'],
        ]);
  const episodes = rows.flatMap((row) => {
    if (typeof row.id !== 'string' || typeof row.started_at !== 'string') return [];
    env.state.spans.set(row.id, { start: Date.parse(row.started_at), end: typeof row.ended_at === 'string' ? Date.parse(row.ended_at) : null });
    const own = doses.flatMap((dose) =>
      dose.episode_id === row.id && typeof dose.medication_id === 'string' ? [{ medicationId: dose.medication_id, takenAt: dose.taken_at }] : [],
    );
    return [
      {
        ref: env.refs.add('e', row.id),
        started_at: zonedIso(env, row.started_at),
        ended_at: zonedIso(env, row.ended_at),
        intensity: typeof row.intensity === 'number' ? row.intensity : null,
        pain_areas: stringsOf(row.pain_areas),
        symptoms: stringsOf(row.symptoms),
        triggers: stringsOf(row.triggers),
        reliefs: stringsOf(row.reliefs),
        helped: stringsOf(row.helped),
        did_not_help: stringsOf(row.did_not_help),
        doses: own.slice(0, MAX_DOSES_PER_EPISODE).map((dose) => ({ medication_ref: env.refs.add('m', dose.medicationId), taken_at: zonedIso(env, dose.takenAt) })),
      },
    ];
  });
  const resultRef = env.refs.add('r', call.id);
  const truncated = ids.some((id) => doses.filter((dose) => dose.episode_id === id).length > MAX_DOSES_PER_EPISODE);
  return {
    content: { result_ref: resultRef, episodes, total, ...(truncated ? { truncated } : {}) },
    isError: false,
    evidence: [{ ref: resultRef, source: 'episodes', count: episodes.length, of: null, episodeIds: ids, doseIds: [] }],
  };
}

const nextMonthStart = (localDate: string): string => {
  const [year = 2000, month = 1] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
};

async function getCabinet(env: ToolEnv): Promise<ToolOutcome> {
  const today = localDateIn(new Date(env.now()), env.timeZone);
  const monthStart = `${today.slice(0, 8)}01`;
  const [medications, doses] = await Promise.all([
    readRows(env, 'medications', [
      ['select', 'id,name,kind,class,form,dose_text,min_interval_minutes,archived_at'],
      ['order', 'created_at.asc'],
      ['limit', String(READ_ROWS)],
    ]),
    readRows(env, 'doses', [
      ['select', 'id,medication_id,taken_at'],
      ['taken_at', `gte.${new Date(zonedMidnight(monthStart, env.timeZone)).toISOString()}`],
      ['taken_at', `lt.${new Date(zonedMidnight(nextMonthStart(today), env.timeZone)).toISOString()}`],
      ['order', 'taken_at.desc'],
      ['limit', String(READ_ROWS)],
    ]),
  ]);

  const active = medications.flatMap((med) => {
    const name = textUpTo(med.name, NAME_MAX_CHARS);
    if (typeof med.id !== 'string' || med.archived_at !== null || name === null) return [];
    return [{ id: med.id, name, kind: med.kind, class: med.class, form: med.form, doseText: med.dose_text, interval: med.min_interval_minutes }];
  });
  const listed = active.slice(0, MAX_CABINET_MEDICATIONS).map((med) => ({
    ref: env.refs.add('m', med.id),
    name: med.name,
    kind: med.kind,
    class: med.class,
    form: med.form,
    dose_text: textUpTo(med.doseText, DOSE_TEXT_MAX_CHARS),
    has_min_interval: med.interval !== null && med.interval !== undefined,
  }));

  // Archived medications' doses still count, as on Today; preventive ones never do.
  const acuteClass = new Map<string, MedicationClass>(
    medications.flatMap((med) => (typeof med.id === 'string' && med.kind === 'acute' ? [[med.id, med.class as MedicationClass]] : [])),
  );
  const monthDoses = doses.flatMap((dose) =>
    typeof dose.id === 'string' && typeof dose.medication_id === 'string' && typeof dose.taken_at === 'string'
      ? [{ id: dose.id, medicationId: dose.medication_id, takenAt: dose.taken_at }]
      : [],
  );
  const status = overuseStatus(
    doseDaysForMonth(
      monthDoses,
      [...acuteClass].map(([id, medicationClass]) => ({ id, kind: 'acute' as const, medicationClass })),
      new Date(env.now()),
      env.timeZone,
    ),
    env.pack,
  );
  const month = today.slice(0, 8);
  const doseIdsOf = (classes: readonly MedicationClass[]): string[] =>
    monthDoses
      .filter((dose) => {
        const medicationClass = acuteClass.get(dose.medicationId);
        return medicationClass !== undefined && classes.includes(medicationClass) && localDateIn(new Date(dose.takenAt), env.timeZone).startsWith(month);
      })
      .map((dose) => dose.id);

  const evidence: Evidence[] = [];
  // Only classes with a day, in pack order.
  const byClass = Object.fromEntries(
    Object.entries(status.byClass).flatMap(([medicationClass, entry]) => {
      if (entry.days === 0) return [];
      const ref = env.refs.add('o', `class:${medicationClass}`);
      evidence.push({ ref, source: 'overuse', count: entry.days, of: entry.limit, episodeIds: [], doseIds: doseIdsOf([medicationClass as MedicationClass]) });
      return [[medicationClass, { ref, days: entry.days, limit: entry.limit, level: entry.level }]];
    }),
  );
  const combinedRef = env.refs.add('o', 'combined');
  const { combined } = status;
  evidence.push({ ref: combinedRef, source: 'overuse', count: combined.days, of: combined.limit, episodeIds: [], doseIds: doseIdsOf(combined.classes) });
  return {
    content: {
      medications: listed,
      ...(active.length > listed.length ? { truncated: true } : {}),
      overuse: { by_class: byClass, combined: { ref: combinedRef, days: combined.days, limit: combined.limit, level: combined.level, classes: [...combined.classes] } },
    },
    isError: false,
    evidence,
  };
}

async function getCrisisPlan(env: ToolEnv): Promise<ToolOutcome> {
  const [episodes, doses, medications] = await Promise.all([
    readRows(env, 'episodes', [
      ['select', 'id,helped,did_not_help,debriefed_at'],
      ['debriefed_at', 'not.is.null'],
      ['order', 'debriefed_at.desc'],
      ['limit', String(READ_ROWS)],
    ]),
    readRows(env, 'doses', [
      ['select', 'id,medication_id,episode_id,helped'],
      ['helped', 'not.is.null'],
      ['order', 'taken_at.desc'],
      ['limit', String(READ_ROWS)],
    ]),
    // Only medications still in the cabinet, as What helped before shows: an archived one is not theirs to reach for.
    readRows(env, 'medications', [
      ['select', 'id,name'],
      ['archived_at', 'is.null'],
      ['order', 'created_at.asc'],
      ['limit', String(READ_ROWS)],
    ]),
  ]);
  const names = new Map(medications.flatMap((med) => (typeof med.id === 'string' && typeof med.name === 'string' ? [[med.id, med.name]] : [])));
  const plan = crisisPlan(
    episodes.flatMap((row: Row) =>
      typeof row.id === 'string'
        ? [{ id: row.id, helped: stringsOf(row.helped), didNotHelp: stringsOf(row.did_not_help), debriefedAt: typeof row.debriefed_at === 'string' ? row.debriefed_at : null }]
        : [],
    ),
    doses.flatMap((row: Row) =>
      typeof row.id === 'string' && typeof row.medication_id === 'string'
        ? [{ id: row.id, medicationId: row.medication_id, episodeId: typeof row.episode_id === 'string' ? row.episode_id : null, helped: typeof row.helped === 'boolean' ? row.helped : null }]
        : [],
    ),
  )
    .flatMap((entry) => {
      const name = entry.kind === 'relief' ? entry.key : names.get(entry.key);
      return name === undefined ? [] : [{ ...entry, name }];
    })
    .slice(0, PLAN_ENTRIES);
  const evidence: Evidence[] = [];
  const entries = plan.map((entry) => {
    const ref = env.refs.add('p', `${entry.kind}:${entry.key}`);
    evidence.push({ ref, source: 'crisis_plan', count: entry.helped, of: entry.of, episodeIds: [...entry.episodeIds], doseIds: [] });
    return { ref, kind: entry.kind, name: entry.name, helped: entry.helped, of: entry.of };
  });
  return { content: { plan: entries }, isError: false, evidence };
}

/** An insight's own fields, snake_case; `chance` stays out, as a probability invites a percentage. */
function insightFields(insight: Insight, env: ToolEnv, names: ReadonlyMap<string, string>): Record<string, unknown> | null {
  switch (insight.kind) {
    case 'monthly_frequency':
      return { key: insight.key, avg_intensity: insight.avgIntensity, partial: insight.partial };
    case 'attack_free_streak':
      return { key: insight.key, best_days: insight.bestDays };
    case 'trigger_frequency':
      return { key: insight.key };
    case 'time_of_day':
    case 'weekday':
      return { key: insight.key, buckets: insight.buckets, pattern: insight.pattern };
    case 'helped': {
      if (insight.source === 'relief') return { source: 'relief', key: insight.key };
      // The medication by ref and name, never its id.
      const name = textUpTo(names.get(insight.key), NAME_MAX_CHARS);
      return name === null ? null : { source: 'medication', medication_ref: env.refs.add('m', insight.key), name };
    }
    case 'sleep_before':
      return {
        key: insight.key,
        baseline: insight.baseline,
        avg_hours: { attack_nights: insight.avgHours.attackNights, other_nights: insight.avgHours.otherNights },
        checkins: insight.checkins,
      };
  }
}

async function getInsights(input: Record<string, unknown>, env: ToolEnv): Promise<ToolOutcome> {
  const kind = optionalOf(INSIGHT_KINDS, input.kind);
  const now = new Date(env.now());
  const { data, error } = await rpcClient(env.supabase, env.fetch, env.auth, env.timeoutMs()).rpc('record_inputs', {
    p_user_id: env.userId,
    p_since: new Date(now.getTime() - INSIGHT_SINCE_DAYS * DAY_MS).toISOString(),
  });
  const records = error === null ? parseRecordInputs(data) : null;
  if (records === null) throw new Error('record_inputs failed');
  // Insight dates are local dates, and an unknown zone would throw: the handler's zone, checked again.
  const timeZone = zoneOrUtc(env.timeZone);
  const insightData = { ...records, now, timeZone, trackingSince: trackingSinceOf(records, timeZone, now) };
  const wanted = <T extends { kind: string }>(items: readonly T[]): T[] => items.filter((item) => kind === null || item.kind === kind);
  const names = new Map(records.medications.map((med) => [med.id, med.name]));
  const evidence: Evidence[] = [];
  const insights = wanted(computeInsights(insightData, env.pack)).flatMap((insight) => {
    const fields = insightFields(insight, env, names);
    if (fields === null) return [];
    const ref = env.refs.add('i', `${insight.kind}:${insight.kind === 'helped' ? insight.source : ''}:${insight.key}`);
    evidence.push({ ref, source: 'insight', count: insight.count, of: insight.of, episodeIds: [...insight.episodeIds], doseIds: [] });
    return [{ ref, kind: insight.kind, ...fields, count: insight.count, of: insight.of, window_days: insight.windowDays }];
  });
  const needs = wanted(insightNeeds(insightData, env.pack)).map((need) => ({ kind: need.kind, unit: need.unit, min: need.min, have: need.have }));
  return { content: { status: 'ok', insights, needs }, isError: false, evidence };
}

/** The ref the model gave and the id behind it; both null when it gave none. */
function optionalRef(env: ToolEnv, prefix: RefPrefix, value: unknown): { ref: string; id: string } | { ref: null; id: null } {
  if (absent(value)) return { ref: null, id: null };
  if (typeof value !== 'string') throw new Invalid('unknown_ref');
  return { ref: value, id: refId(env, prefix, value) };
}

function proposeEpisode(call: ToolCall, input: Record<string, unknown>, env: ToolEnv): ToolOutcome {
  const { ref: episodeRef, id: episodeId } = optionalRef(env, 'e', input.episode_ref);
  const startedAt = optionalTime(env, input.started_at);
  const endedAt = optionalTime(env, input.ended_at);
  let intensity: number | null = null;
  if (!absent(input.intensity)) {
    if (typeof input.intensity !== 'number' || !Number.isInteger(input.intensity) || input.intensity < 0 || input.intensity > 10) throw new Invalid('invalid_intensity');
    intensity = input.intensity;
  }
  const lists = {
    painAreas: keyList(env, 'painAreas', input.pain_areas),
    symptoms: keyList(env, 'symptoms', input.symptoms),
    triggers: keyList(env, 'triggers', input.triggers),
    reliefs: keyList(env, 'reliefs', input.reliefs),
    helped: keyList(env, 'reliefs', input.helped),
    didNotHelp: keyList(env, 'reliefs', input.did_not_help),
  };
  if (!absent(input.doses) && !Array.isArray(input.doses)) throw new Invalid('invalid_value');
  const doses = ((input.doses ?? []) as unknown[]).map((dose) => {
    if (!isRecord(dose)) throw new Invalid('invalid_value');
    return { ref: String(dose.medication_ref), medicationId: refId(env, 'm', dose.medication_ref), takenAt: timeOf(env, dose.taken_at) };
  });
  // Against the stored span too, so moving a start past the saved end is refused like the reverse.
  const span = episodeId === null ? undefined : env.state.spans.get(episodeId);
  const start = startedAt ?? span?.start;
  const end = endedAt ?? span?.end ?? null;
  if (end !== null && start !== undefined && end < start) throw new Invalid('end_before_start');
  if (episodeId === null) {
    if (startedAt === null) throw new Invalid('started_at_required');
    // A second open attack is not possible: the new one is past (with an end), or the open one is meant.
    if (endedAt === null && env.openEpisode !== null) throw new Invalid('open_attack', { episode_ref: env.refs.add('e', env.openEpisode.id) });
  } else if (startedAt === null && endedAt === null && intensity === null && doses.length === 0 && Object.values(lists).every((list) => list.length === 0)) {
    throw new Invalid('empty_draft');
  }
  claimDraft(env);
  const ref = env.refs.add('d', call.id);
  const draft: EpisodeDraft = {
    kind: 'episode',
    ref,
    episodeId,
    startedAt: iso(startedAt),
    endedAt: iso(endedAt),
    intensity,
    ...lists,
    doses: doses.map((dose) => ({ medicationId: dose.medicationId, takenAt: new Date(dose.takenAt).toISOString() })),
  };
  return {
    content: {
      draft_ref: ref,
      draft: {
        episode_ref: episodeRef,
        started_at: local(env, startedAt),
        ended_at: local(env, endedAt),
        intensity,
        pain_areas: lists.painAreas,
        symptoms: lists.symptoms,
        triggers: lists.triggers,
        reliefs: lists.reliefs,
        helped: lists.helped,
        did_not_help: lists.didNotHelp,
        doses: doses.map((dose) => ({ medication_ref: dose.ref, taken_at: local(env, dose.takenAt) })),
      },
    },
    isError: false,
    draft,
  };
}

function proposeDose(call: ToolCall, input: Record<string, unknown>, env: ToolEnv): ToolOutcome {
  const medicationId = refId(env, 'm', input.medication_ref);
  const takenAt = timeOf(env, input.taken_at);
  const { ref: episodeRef, id: episodeId } = optionalRef(env, 'e', input.episode_ref);
  claimDraft(env);
  const ref = env.refs.add('d', call.id);
  const draft: DoseDraft = { kind: 'dose', ref, medicationId, takenAt: new Date(takenAt).toISOString(), episodeId };
  return {
    content: { draft_ref: ref, draft: { medication_ref: input.medication_ref, taken_at: local(env, takenAt), episode_ref: episodeRef } },
    isError: false,
    draft,
  };
}

function proposeCheckin(call: ToolCall, input: Record<string, unknown>, env: ToolEnv): ToolOutcome {
  if (!isLocalDate(input.local_date)) throw new Invalid('invalid_date');
  const localDate = input.local_date;
  if (localDate > env.localDate || localDate < addDays(env.localDate, 1 - CHECKIN_WINDOW_DAYS)) throw new Invalid('date_out_of_range');
  const fields = {
    sleepBand: optionalOf(SLEEP_BANDS, input.sleep_band),
    sleepQuality: optionalOf(SLEEP_QUALITIES, input.sleep_quality),
    stress: optionalOf(STRESS_LEVELS, input.stress),
    lowWater: optionalBoolean(input.low_water),
    extraCaffeine: optionalBoolean(input.extra_caffeine),
    alcohol: optionalBoolean(input.alcohol),
    skippedMeal: optionalBoolean(input.skipped_meal),
    screenHeavy: optionalBoolean(input.screen_heavy),
  };
  claimDraft(env);
  const ref = env.refs.add('d', call.id);
  const draft: CheckinDraft = { kind: 'checkin', ref, localDate, ...fields };
  return {
    content: {
      draft_ref: ref,
      draft: {
        local_date: localDate,
        sleep_band: fields.sleepBand,
        sleep_quality: fields.sleepQuality,
        stress: fields.stress,
        low_water: fields.lowWater,
        extra_caffeine: fields.extraCaffeine,
        alcohol: fields.alcohol,
        skipped_meal: fields.skippedMeal,
        screen_heavy: fields.screenHeavy,
      },
    },
    isError: false,
    draft,
  };
}

async function saveNote(input: Record<string, unknown>, env: ToolEnv): Promise<ToolOutcome> {
  if (typeof input.text !== 'string') throw new Invalid('invalid_value');
  // Control characters and line separators become spaces: the database refuses them, and in the prompt they could fake a line.
  const note = spaceInvisible(input.text).replace(/\s+/g, ' ').trim();
  if (note === '') throw new Invalid('empty');
  if (Array.from(note).length > NOTE_MAX_CHARS) throw new Invalid('too_long');
  const { data, error } = await rpcClient(env.supabase, env.fetch, env.auth, env.timeoutMs()).rpc('save_agent_note', { p_text: note });
  // 23514 is the database's 20-note cap (the length was checked above).
  if (isRecord(error) && error.code === '23514') throw new Invalid('note_limit');
  if (error !== null || typeof data !== 'string' || !UUID.test(data)) throw new Error('save_agent_note failed');
  return { content: { saved: true, ref: env.refs.add('n', data) }, isError: false };
}

async function forgetNote(input: Record<string, unknown>, env: ToolEnv): Promise<ToolOutcome> {
  const id = refId(env, 'n', input.note_ref);
  const { error } = await rpcClient(env.supabase, env.fetch, env.auth, env.timeoutMs()).rpc('delete_agent_note', { p_id: id });
  if (error !== null) throw new Error('delete_agent_note failed');
  return { content: { forgotten: true }, isError: false };
}

/** Runs one call. An input it refuses is an `is_error` result with a reason word; a failed read is `unavailable`. Never throws. */
export async function runTool(call: ToolCall, env: ToolEnv): Promise<ToolOutcome> {
  const { input } = call;
  if (!isRecord(input)) return { content: { error: 'invalid_input' }, isError: true };
  try {
    switch (call.name) {
      case 'get_episodes':
        return await getEpisodes(call, input, env);
      case 'get_insights':
        return await getInsights(input, env);
      case 'get_cabinet':
        return await getCabinet(env);
      case 'get_signals':
        return { content: { status: 'not_available_yet', signals: [] }, isError: false };
      case 'get_crisis_plan':
        return await getCrisisPlan(env);
      // The proposals are synchronous, so parallel calls in one round claim the draft cap one at a time.
      case 'propose_episode':
        return proposeEpisode(call, input, env);
      case 'propose_dose':
        return proposeDose(call, input, env);
      case 'propose_checkin':
        return proposeCheckin(call, input, env);
      case 'save_note':
        return await saveNote(input, env);
      case 'forget_note':
        return await forgetNote(input, env);
      default:
        return { content: { error: 'unknown_tool' }, isError: true };
    }
  } catch (error) {
    if (error instanceof Invalid) return { content: { error: error.reason, ...error.hint }, isError: true };
    return { content: { error: 'unavailable' }, isError: true };
  }
}
