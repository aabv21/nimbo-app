import { catalogKeys, packs } from '../index.ts';

const pack = packs.migraine;

test('catalogs hold exactly these keys', () => {
  expect(catalogKeys(pack, 'painAreas')).toEqual([
    'forehead', 'temple_left', 'temple_right', 'eye_left', 'eye_right',
    'face', 'crown', 'back_left', 'back_right', 'neck',
  ]);
  expect(catalogKeys(pack, 'symptoms')).toEqual([
    'aura_visual', 'light_sensitivity', 'sound_sensitivity', 'smell_sensitivity', 'nausea',
    'vomiting', 'dizziness', 'numbness_tingling', 'neck_stiffness', 'brain_fog', 'fatigue',
  ]);
  expect(catalogKeys(pack, 'triggers')).toEqual([
    'caffeine', 'alcohol', 'stress', 'short_sleep', 'oversleep', 'dehydration', 'skipped_meal',
    'food', 'screens', 'weather', 'hormones', 'bright_light', 'strong_smell', 'loud_noise',
    'exertion', 'travel',
  ]);
  expect(catalogKeys(pack, 'reliefs')).toEqual([
    'medication', 'sleep', 'water', 'cold_pack', 'heat', 'dark_room', 'caffeine', 'massage',
    'meditation', 'fresh_air',
  ]);
});

test('every label key follows condition.<catalog>.<key>', () => {
  for (const catalog of ['painAreas', 'symptoms', 'triggers', 'reliefs'] as const) {
    for (const item of pack[catalog]) expect(item.labelKey).toBe(`condition.${catalog}.${item.key}`);
  }
});

test('overuse limits are the ICHD-3 medication-overuse day counts', () => {
  expect(pack.overuseDayLimits).toEqual({
    simple_analgesic: 15, triptan: 10, ergot: 10, opioid: 10,
    combination_analgesic: 10, gepant: null, other: null,
  });
  expect(pack.overuseWarnRatio).toBe(0.8);
});

test('duration limits', () => {
  expect(pack.limits).toEqual({ longEpisodeHours: 12, statusHours: 72, auraMinutes: 60 });
});
