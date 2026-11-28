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
}
