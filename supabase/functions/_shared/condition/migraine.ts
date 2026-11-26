import type { CatalogItem, CatalogName, ConditionPack } from './types.ts';

// Every list is frozen so app code cannot mutate the shared pack.
function items(catalog: CatalogName, keys: readonly string[]): readonly CatalogItem[] {
  return Object.freeze(
    keys.map((key) => Object.freeze({ key, labelKey: `condition.${catalog}.${key}` })),
  );
}

export const migraine: ConditionPack = Object.freeze({
  id: 'migraine',
  painAreas: items('painAreas', [
    'forehead', 'temple_left', 'temple_right', 'eye_left', 'eye_right',
    'face', 'crown', 'back_left', 'back_right', 'neck',
  ]),
  symptoms: items('symptoms', [
    'aura_visual', 'light_sensitivity', 'sound_sensitivity', 'smell_sensitivity', 'nausea',
    'vomiting', 'dizziness', 'numbness_tingling', 'neck_stiffness', 'brain_fog', 'fatigue',
  ]),
  triggers: items('triggers', [
    'caffeine', 'alcohol', 'stress', 'short_sleep', 'oversleep', 'dehydration', 'skipped_meal',
    'food', 'screens', 'weather', 'hormones', 'bright_light', 'strong_smell', 'loud_noise',
    'exertion', 'travel',
  ]),
  reliefs: items('reliefs', [
    'medication', 'sleep', 'water', 'cold_pack', 'heat', 'dark_room', 'caffeine', 'massage',
    'meditation', 'fresh_air',
  ]),
  medicationClasses: Object.freeze([
    'simple_analgesic', 'triptan', 'ergot', 'opioid', 'combination_analgesic', 'gepant', 'other',
  ] as const),
  // ICHD-3 8.2: >=15 days/month for simple analgesics, >=10 for ergot, triptans, opioids and combinations.
  overuseDayLimits: Object.freeze({
    simple_analgesic: 15,
    triptan: 10,
    ergot: 10,
    opioid: 10,
    combination_analgesic: 10,
    gepant: null,
    other: null,
  }),
  overuseWarnRatio: 0.8,
  limits: Object.freeze({ longEpisodeHours: 12, statusHours: 72, auraMinutes: 60 }),
});
