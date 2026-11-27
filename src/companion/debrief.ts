// The day-after debrief's rules: which attack is asked about, which chips each question offers, and the greeting.
import type { Dose } from '../cabinet/doseStore';
import type { Medication } from '../cabinet/medicationStore';
import { localDateIn } from '../condition';
import type { ConditionPack } from '../condition';
import type { Episode } from '../episodes/episodeStore';

/** An attack that ended longer ago than this is no longer asked about: the memory of what helped has faded. */
export const DEBRIEF_MAX_AGE_DAYS = 3;

export type DebriefStep = 'helped' | 'not_helped' | 'triggers';

/** A relief or trigger chip has a catalog `labelKey`; a medication's chip (its key is the medication id) has the name. */
export interface DebriefChip {
  key: string;
  kind: 'relief' | 'dose' | 'trigger';
  labelKey: string | null;
  label: string | null;
}

/** The morning after: nothing is asked about yesterday's attack before this local hour, so "Good morning" holds. */
export const DEBRIEF_FROM_HOUR = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

const hourFormats = new Map<string, Intl.DateTimeFormat>();

/** The hour (0–23) on the clock in `timeZone`. */
function localHourIn(date: Date, timeZone: string): number {
  let format = hourFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23' });
    hourFormats.set(timeZone, format);
  }
  return Number(format.formatToParts(date).find((part) => part.type === 'hour')?.value);
}

/** Whole calendar days from the local day `ended` fell on to today's, in `timeZone`. */
function daysSince(ended: string, now: Date, timeZone: string): number {
  const day = (date: Date): number => Date.parse(`${localDateIn(date, timeZone)}T00:00:00Z`);
  return Math.round((day(now) - day(new Date(ended))) / DAY_MS);
}

/**
 * The attack to ask about: the one that ended last, on a local day before today (yesterday's only from
 * `DEBRIEF_FROM_HOUR`) and at most `DEBRIEF_MAX_AGE_DAYS` ago, not debriefed and not in `skipped` (those finished on
 * this phone); null when there is none.
 */
export function debriefDue(episodes: readonly Episode[], now: Date, timeZone: string, skipped: ReadonlySet<string>): Episode | null {
  let due: Episode | null = null;
  const morning = localHourIn(now, timeZone) >= DEBRIEF_FROM_HOUR;
  for (const episode of episodes) {
    const { endedAt } = episode;
    if (endedAt === null || episode.debriefedAt !== null || skipped.has(episode.id)) continue;
    const days = daysSince(endedAt, now, timeZone);
    if (days < 1 || days > DEBRIEF_MAX_AGE_DAYS || (days === 1 && !morning)) continue;
    if (due?.endedAt == null || Date.parse(endedAt) > Date.parse(due.endedAt)) due = episode;
  }
  return due;
}

/**
 * The chips a step offers. "What helped": the attack's own reliefs, then the medications it took (one chip each,
 * however many doses), then the pack's other reliefs. "What did not": the same, less what helped. Triggers: the pack's.
 */
export function debriefChips(
  step: DebriefStep,
  episode: Episode,
  doses: readonly Dose[],
  meds: readonly Medication[],
  pack: ConditionPack,
  picked: { helped: readonly string[] },
): DebriefChip[] {
  if (step === 'triggers') return pack.triggers.map((item) => ({ key: item.key, kind: 'trigger', labelKey: item.labelKey, label: null }));
  const relief = (key: string): DebriefChip[] => {
    const item = pack.reliefs.find((candidate) => candidate.key === key);
    // A key this pack does not know could not be saved, so it is not offered.
    return item === undefined ? [] : [{ key, kind: 'relief', labelKey: item.labelKey, label: null }];
  };
  const own = episode.reliefs.flatMap(relief);
  const taken = [...doses]
    .filter((dose) => dose.episodeId === episode.id)
    .sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
  const medicationChips = [...new Set(taken.map((dose) => dose.medicationId))].map((id): DebriefChip => {
    const name = meds.find((medication) => medication.id === id)?.name;
    return name === undefined ? { key: id, kind: 'dose', labelKey: 'draft.k.dose', label: null } : { key: id, kind: 'dose', labelKey: null, label: name };
  });
  const others = pack.reliefs.filter((item) => !episode.reliefs.includes(item.key)).flatMap((item) => relief(item.key));
  const chips = [...own, ...medicationChips, ...others];
  return step === 'helped' ? chips : chips.filter((chip) => !picked.helped.includes(chip.key));
}

/** "Yesterday you had…" for an attack that ended yesterday, else the greeting that names its date. */
export function debriefGreetingKey(episode: Episode, now: Date, timeZone: string): 'debrief.q.helped.yesterday' | 'debrief.q.helped.date' {
  return episode.endedAt !== null && daysSince(episode.endedAt, now, timeZone) === 1 ? 'debrief.q.helped.yesterday' : 'debrief.q.helped.date';
}
