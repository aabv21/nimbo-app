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
}
