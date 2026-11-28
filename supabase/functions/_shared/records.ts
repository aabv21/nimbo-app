// The records the insights and signals read, with the same shape on the phone and on the server.
import { localDateIn } from './condition/doseDays.ts';
import type { MedicationClass, SleepBand } from './condition/types.ts';

export interface RecordEpisode {
  id: string;
  startedAt: string;
  endedAt: string | null;
  intensity: number | null;
  triggers: readonly string[];
  helped: readonly string[];
  didNotHelp: readonly string[];
  debriefedAt: string | null;
}

export interface RecordCheckin {
  localDate: string;
  sleepBand: SleepBand | null;
  stress: 'low' | 'mid' | 'high' | null;
}

export interface RecordDose {
  id: string;
  medicationId: string;
  episodeId: string | null;
  takenAt: string;
  helped: boolean | null;
}

export interface RecordMedication {
  id: string;
  name: string;
  kind: 'preventive' | 'acute';
  class: MedicationClass;
}

export interface Records {
  episodes: readonly RecordEpisode[];
  checkins: readonly RecordCheckin[];
  doses: readonly RecordDose[];
  medications: readonly RecordMedication[];
}

/** `record_inputs`' answer: the records plus the profile fields the rules read (never the location itself). */
export interface RecordInputs extends Records {
  timeZone: string | null;
  knownTriggers: readonly string[];
  onboardedAt: string | null;
  hasLocation: boolean;
}

/** One `record_inputs` read covers the monthly frequency (6 months) and the streak (365 days). */
export const INSIGHT_SINCE_DAYS = 366;

// Records keep the type checker honest: a band or class added to the union fails to compile here.
const SLEEP_BANDS: Readonly<Record<SleepBand, true>> = { lt5: true, '5_6': true, '6_7': true, '7_8': true, gt8: true };
const CLASSES: Readonly<Record<MedicationClass, true>> = {
  simple_analgesic: true,
  triptan: true,
  ergot: true,
  opioid: true,
  combination_analgesic: true,
  gepant: true,
  other: true,
};
const STRESS = ['low', 'mid', 'high'] as const;
const KINDS = ['preventive', 'acute'] as const;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const timeOrNull = (value: unknown): string | null | undefined => (value === null ? null : isTime(value) ? value : undefined);
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined => options.find((option) => option === value);
const keyOf = <T extends string>(options: Readonly<Record<T, true>>, value: unknown): T | undefined =>
  typeof value === 'string' && Object.hasOwn(options, value) ? (value as T) : undefined;

function episodeOf(row: Row): RecordEpisode | null {
  const endedAt = timeOrNull(row.endedAt);
  const debriefedAt = timeOrNull(row.debriefedAt);
  const intensity = row.intensity === null ? null : typeof row.intensity === 'number' && Number.isFinite(row.intensity) ? row.intensity : undefined;
  if (!isText(row.id) || !isTime(row.startedAt) || endedAt === undefined || debriefedAt === undefined || intensity === undefined) return null;
  if (!isTexts(row.triggers) || !isTexts(row.helped) || !isTexts(row.didNotHelp)) return null;
  return { id: row.id, startedAt: row.startedAt, endedAt, intensity, triggers: row.triggers, helped: row.helped, didNotHelp: row.didNotHelp, debriefedAt };
}

function checkinOf(row: Row): RecordCheckin | null {
  const sleepBand = row.sleepBand === null ? null : keyOf(SLEEP_BANDS, row.sleepBand);
  const stress = row.stress === null ? null : oneOf(STRESS, row.stress);
  if (typeof row.localDate !== 'string' || !LOCAL_DATE.test(row.localDate) || sleepBand === undefined || stress === undefined) return null;
  return { localDate: row.localDate, sleepBand, stress };
}

function doseOf(row: Row): RecordDose | null {
  const episodeId = row.episodeId === null ? null : isText(row.episodeId) ? row.episodeId : undefined;
  const helped = row.helped === null ? null : typeof row.helped === 'boolean' ? row.helped : undefined;
  if (!isText(row.id) || !isText(row.medicationId) || !isTime(row.takenAt) || episodeId === undefined || helped === undefined) return null;
  return { id: row.id, medicationId: row.medicationId, episodeId, takenAt: row.takenAt, helped };
}

function medicationOf(row: Row): RecordMedication | null {
  const kind = oneOf(KINDS, row.kind);
  const medicationClass = keyOf(CLASSES, row.class);
  if (!isText(row.id) || typeof row.name !== 'string' || kind === undefined || medicationClass === undefined) return null;
  return { id: row.id, name: row.name, kind, class: medicationClass };
}

function listOf<T>(value: unknown, parse: (row: Row) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item: unknown) => {
    const parsed = isRow(item) ? parse(item) : null;
    return parsed === null ? [] : [parsed];
  });
}

/** Null for anything that is not that shape; unknown sleep bands, stress values or classes drop the row, not the whole answer. */
export function parseRecordInputs(value: unknown): RecordInputs | null {
  if (!isRow(value)) return null;
  const episodes = listOf(value.episodes, episodeOf);
  const checkins = listOf(value.checkins, checkinOf);
  const doses = listOf(value.doses, doseOf);
  const medications = listOf(value.medications, medicationOf);
  const onboardedAt = timeOrNull(value.onboardedAt);
  const timeZone = value.timeZone === null ? null : typeof value.timeZone === 'string' ? value.timeZone : undefined;
  if (episodes === null || checkins === null || doses === null || medications === null) return null;
  if (onboardedAt === undefined || timeZone === undefined || !isTexts(value.knownTriggers) || typeof value.hasLocation !== 'boolean') return null;
  return { timeZone, knownTriggers: value.knownTriggers, onboardedAt, hasLocation: value.hasLocation, episodes, checkins, doses, medications };
}

/** The earlier of the onboarding date and the first record, as a local date in `timeZone`; today with neither. */
export function trackingSinceOf(inputs: RecordInputs, timeZone: string, now: Date = new Date()): string {
  const local = (instant: string): string => localDateIn(new Date(instant), timeZone);
  const dates = [
    ...(inputs.onboardedAt === null ? [] : [local(inputs.onboardedAt)]),
    ...inputs.episodes.map((episode) => local(episode.startedAt)),
    ...inputs.doses.map((dose) => local(dose.takenAt)),
    ...inputs.checkins.map((checkin) => checkin.localDate),
  ];
  return dates.reduce((earliest, date) => (date < earliest ? date : earliest), localDateIn(now, timeZone));
}
