// Condition pack contract shared by the app and the Edge Functions; no runtime imports.
export type Locale = 'en' | 'es' | 'pt';

export type MedicationClass =
  | 'simple_analgesic'
  | 'triptan'
  | 'ergot'
  | 'opioid'
  | 'combination_analgesic'
  | 'gepant'
  | 'other';

export type SleepBand = 'lt5' | '5_6' | '6_7' | '7_8' | 'gt8';

export type DayPart = 'night' | 'morning' | 'afternoon' | 'evening';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

/** The six signal rules, overuse split in two so a limit outranks a debrief and a warning does not. */
export type SignalKind =
  | 'long_attack'
  | 'overuse_limit'
  | 'debrief_due'
  | 'overuse_warn'
  | 'short_sleep'
  | 'pressure'
  | 'quiet_tracker';

export interface CatalogItem {
  readonly key: string;
  readonly labelKey: string;
}

export type CatalogName = 'painAreas' | 'symptoms' | 'triggers' | 'reliefs';

export type RedFlagKey =
  | 'thunderclap'
  | 'weakness'
  | 'fever_stiff_neck'
  | 'head_injury'
  | 'pregnancy'
  | 'long_aura'
  | 'long_attack';

export interface RedFlag {
  readonly key: RedFlagKey;
  /** Message key of the line that says why this needs care now. */
  readonly whyKey: string;
  /** The yes/no question a model screen asks about a message, in English. */
  readonly question: string;
  /** Whole phrases that raise the flag on the phone; empty for a flag raised only by a duration rule. */
  readonly keywords: Readonly<Record<Locale, readonly string[]>>;
  /**
   * Term groups that raise the flag only together: one phrase from every group must appear. For a sign
   * that is ordinary alone, such as a stiff neck, which is red only with a fever. Empty for most flags.
   */
  readonly allOf: readonly Readonly<Record<Locale, readonly string[]>>[];
}

export interface ConditionPack {
  readonly id: string;
  readonly painAreas: readonly CatalogItem[];
  readonly symptoms: readonly CatalogItem[];
  readonly triggers: readonly CatalogItem[];
  readonly reliefs: readonly CatalogItem[];
  readonly medicationClasses: readonly MedicationClass[];
  /** Days with an acute dose per calendar month; null means no limit is tracked. */
  readonly overuseDayLimits: Readonly<Record<MedicationClass, number | null>>;
  readonly overuseWarnRatio: number;
  /** ICHD-3 8.2.6: days a month on two or more of `combinedClasses` together, none overused alone. */
  readonly combinedClassDayLimit: number;
  /** The classes 8.2.6 names; combination analgesics are 8.2.5, with their own limit, and gepants have none. */
  readonly combinedClasses: readonly MedicationClass[];
  readonly limits: {
    readonly longEpisodeHours: number;
    readonly statusHours: number;
    readonly auraMinutes: number;
  };
  /** In the order the urgent-care screen lists them. */
  readonly redFlags: readonly RedFlag[];
  /** Hours a check-in's sleep band stands for, at the band's midpoint. */
  readonly sleepBandHours: Readonly<Record<SleepBand, number>>;
  /** Local hour a record day starts: an attack at 02:30 belongs to the night before. */
  readonly dayStartHour: number;
  /** The insights' window and minimum samples: below a minimum a card shows what is still needed. */
  readonly insights: {
    readonly windowDays: number;
    /** Highest chance of the top count under an even spread that still reads as a pattern. */
    readonly patternChanceMax: number;
    readonly monthlyFrequency: { readonly minTrackedDays: number; readonly months: number };
    readonly streak: { readonly minTrackedDays: number; readonly staleAfterDays: number; readonly maxDays: number };
    readonly triggerFrequency: { readonly minEpisodes: number; readonly minCount: number; readonly top: number };
    readonly timeOfDay: { readonly minEpisodes: number };
    readonly weekday: { readonly minEpisodes: number };
    readonly helped: { readonly minDebriefs: number; readonly minMarked: number; readonly top: number };
    readonly sleepBefore: {
      readonly minCheckins: number;
      readonly minShortNights: number;
      readonly minOtherNights: number;
      readonly minAttackDays: number;
      readonly shortBands: readonly SleepBand[];
    };
    /** Local hours `[from, to)` of each day part. */
    readonly timeOfDayBuckets: Readonly<Record<DayPart, readonly [number, number]>>;
  };
  /** The signal rules' thresholds; the history they read is `insights.windowDays` long. */
  readonly signals: {
    readonly pressure: {
      /** A fall of at least this much from the hour in progress to the same hour `horizonHours` later. */
      readonly dropHpa: number;
      readonly horizonHours: number;
      /** Attacks tagged `weather` in the window that make the rule apply without the onboarding choice. */
      readonly minTaggedEpisodes: number;
      readonly maxForecastAgeHours: number;
    };
    readonly shortSleep: { readonly minAttackNights: number; readonly minGapHours: number };
    /** Hours an open attack must reach for each stage, ascending. */
    readonly longAttackHours: readonly number[];
    readonly quietTrackerDays: number;
    readonly maxOnToday: number;
    readonly suppressDuringAttack: readonly SignalKind[];
    /** Every kind, highest first: the order of Today's rows and of the push choice. */
    readonly priority: readonly SignalKind[];
  };
  readonly push: {
    /** The same cause is not pushed again within this many hours, whatever its key. */
    readonly sameCauseHours: number;
    readonly perRunMax: number;
  };
}
