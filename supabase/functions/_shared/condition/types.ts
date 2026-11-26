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
  readonly limits: {
    readonly longEpisodeHours: number;
    readonly statusHours: number;
    readonly auraMinutes: number;
  };
}
