// The companion's vocabulary, shared by the function and the app (through src/companion/contract.ts).
// Server code cannot import src/, so the check-in draft spells its choices out rather than reusing the app's types.

import type { Locale, RedFlagKey } from '../condition/index.ts';
import { isRecord, UUID } from '../guards.ts';
import type { QuotaKind } from '../quota.ts';

export type { QuotaKind };
// For the app, which imports server code only through src/companion/contract.ts.
export { isRecord };
/** The kinds a 429 can name: the screening unit never refuses a request, it only leaves the screen to the keywords. */
export type ClientQuotaKind = Exclude<QuotaKind, 'screen'>;

export const MODES = ['chat', 'crisis', 'debrief'] as const;
export type Mode = (typeof MODES)[number];

export const GUARD_KEYS = [
  'dose_advice',
  'medication_change',
  'diagnosis',
  'ungrounded_number',
  'overuse_override',
  'red_flag_dismissal',
  'prediction',
] as const;
export type GuardKey = (typeof GUARD_KEYS)[number];

export const INTENTS = ['log_episode', 'end_episode', 'log_dose', 'log_checkin', 'data_question', 'general_question', 'other'] as const;
export type Intent = (typeof INTENTS)[number];

/** A record the agent proposes; nothing is written until the user confirms it. `episodeId` null means a new attack. */
export type EpisodeDraft = {
  kind: 'episode';
  ref: string;
  episodeId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  intensity: number | null;
  painAreas: string[];
  symptoms: string[];
  triggers: string[];
  reliefs: string[];
  helped: string[];
  didNotHelp: string[];
  doses: { medicationId: string; takenAt: string }[];
};

export type DoseDraft = { kind: 'dose'; ref: string; medicationId: string; takenAt: string; episodeId: string | null };

export type CheckinDraft = {
  kind: 'checkin';
  ref: string;
  localDate: string;
  sleepBand: 'lt5' | '5_6' | '6_7' | '7_8' | 'gt8' | null;
  sleepQuality: 'bad' | 'ok' | 'good' | null;
  stress: 'low' | 'mid' | 'high' | null;
  lowWater: boolean | null;
  extraCaffeine: boolean | null;
  alcohol: boolean | null;
  skippedMeal: boolean | null;
  screenHeavy: boolean | null;
};

export type Draft = EpisodeDraft | DoseDraft | CheckinDraft;

/** What a number in a reply rests on: `count` of `of` (null when it is a plain count) and the records behind it. */
export type Evidence = {
  ref: string;
  source: 'episodes' | 'crisis_plan' | 'overuse' | 'insight';
  count: number;
  of: number | null;
  episodeIds: string[];
  doseIds: string[];
};

export type Guard = 'ok' | 'replaced' | 'degraded';

export type ReplacedReason = GuardKey | 'refusal';

const LOCALES = ['en', 'es', 'pt'] as const satisfies readonly Locale[];
export const RED_FLAG_KEYS = [
  'thunderclap',
  'weakness',
  'fever_stiff_neck',
  'head_injury',
  'pregnancy',
  'long_aura',
  'long_attack',
] as const satisfies readonly RedFlagKey[];

/** The history the app sends: turns of plain text, the first and last the user's. */
export const MAX_TURNS = 12;
/** Characters (code points) per turn; a reply is cut to the same, since it comes back as history. */
export const TURN_MAX_CHARS = 500;
export const TOTAL_MAX_CHARS = 4000;

/** An agent note's length, as `agent_notes.text`'s check has it. */
export const NOTE_MAX_CHARS = 200;

export type Turn = { role: 'user' | 'assistant'; text: string };

/**
 * `localDate` is the app's day and `timeZone` the phone's zone (the server checks it before using it);
 * `input: 'voice'` also spends a dictation unit.
 */
export interface CompanionRequest {
  mode: Mode;
  locale: Locale;
  localDate: string;
  input: 'text' | 'voice';
  messages: Turn[];
  episodeId?: string;
  timeZone?: string;
}

/** `profiles.timezone`'s own bound. */
export const TIME_ZONE_MAX_CHARS = 64;

/**
 * `reply` is null when a red flag stopped the request or the guard replaced the reply; the app then renders a
 * template. `guard: 'degraded'` means neither model screened the reply, so the app shows the urgent-care footer.
 */
export interface CompanionResponse {
  reply: string | null;
  drafts: Draft[];
  evidence: Evidence[];
  redFlags: RedFlagKey[];
  intent: Intent;
  guard: Guard;
  replaced: ReplacedReason | null;
}

/** The body of every non-200 answer; `quota` and `limit` only on 429. */
export interface CompanionErrorBody {
  error: 'invalid_input' | 'unauthorized' | 'method_not_allowed' | 'ai_off' | 'over_quota' | 'unavailable' | 'internal';
  quota?: ClientQuotaKind;
  limit?: number;
}

const length = (text: string): number => Array.from(text).length;

/** The trimmed turns, or null unless 1–12 of them, each 1–500 characters, 4,000 in all, first and last the user's. */
export function parseTurns(value: unknown): Turn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TURNS) return null;
  const turns: Turn[] = [];
  let total = 0;
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || (entry.role !== 'user' && entry.role !== 'assistant') || typeof entry.text !== 'string') return null;
    const text = entry.text.trim();
    const size = length(text);
    if (size === 0 || size > TURN_MAX_CHARS) return null;
    total += size;
    turns.push({ role: entry.role, text });
  }
  if (total > TOTAL_MAX_CHARS || turns[0]?.role !== 'user' || turns.at(-1)?.role !== 'user') return null;
  return turns;
}

/** A real `YYYY-MM-DD` day from 2000 on. */
export function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value) && value >= '2000-01-01';
}

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined => options.find((option) => option === value);

/** The request, or null when anything is off; an `episodeId` or `timeZone` that is null or absent is left out. */
export function parseCompanionRequest(body: unknown): CompanionRequest | null {
  if (!isRecord(body)) return null;
  const mode = oneOf(MODES, body.mode);
  const locale = oneOf(LOCALES, body.locale);
  const input = oneOf(['text', 'voice'] as const, body.input);
  const messages = parseTurns(body.messages);
  if (mode === undefined || locale === undefined || input === undefined || messages === null || !isLocalDate(body.localDate)) return null;
  const { episodeId } = body;
  if (episodeId !== undefined && episodeId !== null && (typeof episodeId !== 'string' || !UUID.test(episodeId))) return null;
  const { timeZone } = body;
  if (timeZone !== undefined && timeZone !== null && (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > TIME_ZONE_MAX_CHARS)) return null;
  const request: CompanionRequest = { mode, locale, localDate: body.localDate, input, messages };
  if (typeof episodeId === 'string') request.episodeId = episodeId.toLowerCase();
  if (typeof timeZone === 'string') request.timeZone = timeZone;
  return request;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);
const isNullable = (value: unknown, check: (item: unknown) => boolean): boolean => value === null || check(value);
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isIn =
  <T extends string>(options: readonly T[]) =>
  (value: unknown): value is T =>
    oneOf(options, value) !== undefined;

function isDraft(value: unknown): value is Draft {
  if (!isRecord(value) || !isString(value.ref)) return false;
  switch (value.kind) {
    case 'episode':
      return (
        isNullable(value.episodeId, isString) &&
        isNullable(value.startedAt, isString) &&
        isNullable(value.endedAt, isString) &&
        isNullable(value.intensity, isNumber) &&
        [value.painAreas, value.symptoms, value.triggers, value.reliefs, value.helped, value.didNotHelp].every(isStrings) &&
        Array.isArray(value.doses) &&
        (value.doses as unknown[]).every((dose) => isRecord(dose) && isString(dose.medicationId) && isString(dose.takenAt))
      );
    case 'dose':
      return isString(value.medicationId) && isString(value.takenAt) && isNullable(value.episodeId, isString);
    case 'checkin':
      return (
        isLocalDate(value.localDate) &&
        isNullable(value.sleepBand, isIn(['lt5', '5_6', '6_7', '7_8', 'gt8'])) &&
        isNullable(value.sleepQuality, isIn(['bad', 'ok', 'good'])) &&
        isNullable(value.stress, isIn(['low', 'mid', 'high'])) &&
        [value.lowWater, value.extraCaffeine, value.alcohol, value.skippedMeal, value.screenHeavy].every((flag) => isNullable(flag, isBoolean))
      );
    default:
      return false;
  }
}

function isEvidence(value: unknown): value is Evidence {
  return (
    isRecord(value) &&
    isString(value.ref) &&
    isIn(['episodes', 'crisis_plan', 'overuse', 'insight'])(value.source) &&
    isNumber(value.count) &&
    isNullable(value.of, isNumber) &&
    isStrings(value.episodeIds) &&
    isStrings(value.doseIds)
  );
}

/** The app's check on a 200 body: every field of the right shape, and `replaced` set exactly when the guard replaced the reply. */
export function isCompanionResponse(value: unknown): value is CompanionResponse {
  if (!isRecord(value)) return false;
  const { reply, drafts, evidence, redFlags, intent, guard, replaced } = value;
  if (!isNullable(reply, isString) || !Array.isArray(drafts) || !Array.isArray(evidence) || !Array.isArray(redFlags)) return false;
  if (!drafts.every(isDraft) || !evidence.every(isEvidence) || !redFlags.every(isIn(RED_FLAG_KEYS))) return false;
  if (!isIn(INTENTS)(intent) || !isIn(['ok', 'replaced', 'degraded'] as const)(guard)) return false;
  if (guard === 'replaced') return reply === null && isIn([...GUARD_KEYS, 'refusal'] as const)(replaced);
  return replaced === null;
}
