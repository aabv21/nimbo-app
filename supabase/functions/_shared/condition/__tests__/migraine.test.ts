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
  expect(pack.combinedClassDayLimit).toBe(10);
  expect(pack.combinedClasses).toEqual(['ergot', 'triptan', 'simple_analgesic', 'opioid']);
});

test('duration limits', () => {
  expect(pack.limits).toEqual({ longEpisodeHours: 12, statusHours: 72, auraMinutes: 60 });
});

test('red flags are frozen, in a fixed order, and only fever_stiff_neck needs terms together', () => {
  expect(Object.isFrozen(pack.redFlags)).toBe(true);
  expect(pack.redFlags.map((flag) => flag.key)).toEqual([
    'thunderclap', 'weakness', 'fever_stiff_neck', 'head_injury', 'pregnancy', 'long_aura', 'long_attack',
  ]);
  for (const flag of pack.redFlags) {
    expect(Object.isFrozen(flag)).toBe(true);
    expect(Object.isFrozen(flag.keywords)).toBe(true);
    expect(Object.isFrozen(flag.allOf)).toBe(true);
    expect(flag.allOf.length).toBe(flag.key === 'fever_stiff_neck' ? 2 : 0);
  }
});
