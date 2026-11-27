// The companion's vocabulary, shared by the function and the app (through src/companion/contract.ts).
// Server code cannot import src/, so the check-in draft spells its choices out rather than reusing the app's types.

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
  source: 'episodes' | 'crisis_plan' | 'overuse';
  count: number;
  of: number | null;
  episodeIds: string[];
  doseIds: string[];
};

export type Guard = 'ok' | 'replaced' | 'degraded';

export type ReplacedReason = GuardKey | 'refusal';
