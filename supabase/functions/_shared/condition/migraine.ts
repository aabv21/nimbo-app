import type { CatalogItem, CatalogName, ConditionPack, Locale, RedFlag, RedFlagKey } from './types.ts';

// Every list is frozen so app code cannot mutate the shared pack.
function items(catalog: CatalogName, keys: readonly string[]): readonly CatalogItem[] {
  return Object.freeze(
    keys.map((key) => Object.freeze({ key, labelKey: `condition.${catalog}.${key}` })),
  );
}

type Phrases = Readonly<Record<Locale, readonly string[]>>;

function frozen(phrases: Phrases): Phrases {
  return Object.freeze({
    en: Object.freeze([...phrases.en]),
    es: Object.freeze([...phrases.es]),
    pt: Object.freeze([...phrases.pt]),
  });
}

function flag(key: RedFlagKey, whyKey: string, question: string, keywords: Phrases, allOf: readonly Phrases[] = []): RedFlag {
  return Object.freeze({ key, whyKey, question, keywords: frozen(keywords), allOf: Object.freeze(allOf.map(frozen)) });
}

// "Can't feel my/the" only with a body part after it: "I can't feel the pain anymore" is relief, not numbness.
const NUMB_BODY_PARTS = [
  'arm', 'arms', 'hand', 'hands', 'leg', 'legs', 'foot', 'feet', 'face', 'fingers', 'lips', 'tongue', 'side', 'half',
  'left', 'right', 'toes', 'cheek', 'body',
] as const;
const CANT_FEEL = ["can't feel my", 'cant feel my', 'cannot feel my', "can't feel the", 'cant feel the', 'cannot feel the'].flatMap((prefix) =>
  NUMB_BODY_PARTS.map((part) => `${prefix} ${part}`),
);

// Keywords are whole phrases written as people type them; matching folds case, accents and
// punctuation, so "can't" also covers "CAN'T" and "cabeça" covers "cabeca". Recall comes first:
// a false hit costs one tap on "I'm safe, continue". Calibration fixtures: `calibration/red-flags.*.json`.
const redFlags: readonly RedFlag[] = Object.freeze([
  flag('thunderclap', 'redflag.why.thunderclap', 'Does `message` describe a sudden, explosive or worst-ever headache?', {
    en: [
      'worst headache', 'worst pain', 'worst migraine', 'worst of my life', 'worst ever', 'thunderclap', 'thunder clap',
      'exploded', 'exploding', 'explosion', 'all at once', 'out of nowhere', 'came on suddenly', 'sudden severe',
      'in seconds', 'within seconds', 'like being hit',
    ],
    es: [
      'peor dolor', 'peor migraña', 'peor de mi vida', 'de golpe', 'de la nada', 'de repente', 'trueno', 'como un rayo',
      'explotó', 'explotar', 'explosión', 'estalló', 'en segundos',
    ],
    pt: [
      'pior dor', 'pior enxaqueca', 'pior da minha vida', 'do nada', 'de repente', 'de uma vez', 'trovão',
      'explodir', 'explodiu', 'explodindo', 'explosão', 'em segundos',
    ],
  }),
  flag('weakness', 'redflag.why.weakness', 'Does `message` mention new weakness, numbness, a drooping face, trouble speaking, confusion, vision loss or double vision?', {
    en: [
      'numb', 'numbness', 'drooping', 'droopy', 'slurred', 'slurring', "can't speak", 'cant speak', 'cannot speak',
      "can't talk", 'cant talk', 'trouble speaking', "words won't come out", 'feels weak', 'arm is weak', 'leg is weak',
      'weakness', "can't move my", 'paralyzed', 'confused', 'confusion', "can't see", 'cant see', 'cannot see',
      'lost the vision', 'lost my vision', 'lost vision', 'blind in one eye', 'went blind',
      ...CANT_FEEL, 'no feeling in', 'lost feeling', 'double vision', 'seeing double', 'see double',
    ],
    es: [
      'adormecida', 'adormecido', 'adormecimiento', 'se me adormeció', 'se me duerme', 'se me durmió', 'entumida',
      'entumido', 'entumecida', 'entumecido', 'boca chueca', 'boca torcida', 'cara caída', 'no puedo hablar',
      'no me salen las palabras', 'hablo raro', 'hablo todo raro', 'arrastro las palabras', 'me cuesta hablar',
      'sin fuerza', 'debilidad', 'no puedo mover', 'confundida', 'confundido', 'confusión', 'no puedo ver', 'no veo nada', 'no veo bien', 'no veo de un ojo',
      'perdí la vista', 'me quedé ciega', 'me quedé ciego',
      'no siento el brazo', 'no siento la mano', 'no siento la pierna', 'no siento el pie', 'no siento la cara',
      'no siento los dedos', 'no siento el lado', 'no siento la mitad', 'perdí la sensibilidad', 'visión doble',
      'veo doble', 'viendo doble',
    ],
    pt: [
      'dormente', 'dormência', 'adormecido', 'adormecida', 'boca torta', 'boca ficou torta', 'rosto caído',
      'não consigo falar', 'fala enrolada', 'enrolando pra falar', 'enrolando para falar', 'as palavras não saem',
      'sem força', 'fraqueza', 'não consigo mexer', 'confusa', 'confuso', 'confusão', 'não consigo ver', 'não enxergo',
      'perdi a visão', 'fiquei cega', 'fiquei cego',
      'não sinto o braço', 'não sinto meu braço', 'não sinto a mão', 'não sinto minha mão', 'não sinto a perna',
      'não sinto minha perna', 'não sinto o rosto', 'não sinto o lado', 'não sinto a metade', 'não sinto os dedos',
      'visão dupla', 'vista dupla', 'vejo duplo', 'vendo duplo', 'vejo dobrado', 'vendo dobrado',
    ],
  }),
  // Neck stiffness and a bad headache are common in an ordinary attack, so either raises this flag only
  // with a fever term: the second group holds the neck terms and the severe-headache terms.
  flag(
    'fever_stiff_neck',
    'redflag.why.fever',
    'Does `message` mention a fever together with a stiff neck or a severe headache?',
    {
      en: ['fever and stiff neck', 'fever and a stiff neck', 'stiff neck and fever', 'stiff neck and a fever'],
      es: ['fiebre y cuello rígido', 'fiebre y el cuello rígido', 'fiebre y cuello tieso', 'fiebre y el cuello tieso'],
      pt: ['febre e pescoço duro', 'febre e o pescoço duro', 'febre e pescoço rígido', 'febre e o pescoço rígido'],
    },
    [
      {
        en: ['fever', 'feverish', 'high temperature', 'running a temperature', 'temperature of', 'chills'],
        es: ['fiebre', 'calentura', 'febril', 'temperatura alta', 'escalofríos'],
        pt: ['febre', 'febril', 'temperatura alta', 'calafrios'],
      },
      {
        en: [
          'stiff neck', 'neck is stiff', 'neck is so stiff', "can't bend my neck", 'cant bend my neck',
          'chin to my chest', 'chin to chest',
          'worst headache', 'severe headache', 'severe head pain', 'horrible headache', 'terrible headache',
          'awful headache', 'bad headache', 'unbearable headache', 'unbearable pain', 'excruciating',
        ],
        es: [
          'cuello rígido', 'cuello tieso', 'cuello bien tieso', 'nuca rígida', 'nuca tiesa',
          'no puedo doblar el cuello', 'no puedo bajar la cabeza',
          'dolor de cabeza horrible', 'dolor horrible', 'dolor de cabeza terrible', 'dolor terrible', 'insoportable',
          'fortísimo', 'fortísima', 'fuertísimo', 'fuertísima', 'fuertisimo', 'dolor de cabeza muy fuerte',
          'dolor muy fuerte', 'dolor de cabeza intenso',
        ],
        pt: [
          'pescoço duro', 'pescoço rígido', 'nuca dura', 'nuca rígida', 'não consigo dobrar o pescoço',
          'queixo no peito',
          'dor de cabeça forte', 'dor de cabeça muito forte', 'dor de cabeça intensa', 'dor de cabeça horrível',
          'dor horrível', 'insuportável',
          'fortíssima', 'fortíssimo',
        ],
      },
    ],
  ),
  flag('head_injury', 'redflag.why.head_injury', 'Does `message` say the headache came after a blow to the head or an accident?', {
    en: [
      'hit my head', 'banged my head', 'bumped my head', 'knocked my head', 'fell on my head', 'hit in the head',
      'blow to the head', 'head injury', 'concussion', 'car accident', 'car crash',
    ],
    es: [
      'me pegué en la cabeza', 'me golpeé la cabeza', 'me golpie la cabeza', 'golpe en la cabeza', 'me di un golpe',
      'me pegaron en la cabeza', 'traumatismo', 'conmoción', 'choque', 'accidente',
    ],
    pt: [
      'bati a cabeça', 'bati com a cabeça', 'pancada na cabeça', 'batida na cabeça', 'machuquei a cabeça',
      'traumatismo', 'concussão', 'acidente',
    ],
  }),
  flag('pregnancy', 'redflag.why.pregnancy', 'Does `message` say the person is pregnant or recently gave birth?', {
    en: [
      'pregnant', 'pregnancy', 'gave birth', 'giving birth', 'postpartum', 'post partum', 'had my baby', 'had a baby',
      'c section', 'expecting a baby',
    ],
    es: [
      'embarazada', 'embarazo', 'di a luz', 'dar a luz', 'parto', 'posparto', 'postparto', 'puerperio', 'cesárea',
      'tuve a mi bebé', 'tuve un bebé',
    ],
    pt: [
      'grávida', 'gravidez', 'gestante', 'gestação', 'dei à luz', 'pós-parto', 'posparto', 'puerpério', 'cesárea',
      'cesariana', 'tive bebê', 'tive o bebê', 'tive meu bebê',
    ],
  }),
  flag('long_aura', 'redflag.why.aura', 'Does `message` say an aura has lasted more than an hour?', {
    en: [
      "aura's been", 'aura has been going', 'aura has lasted', 'aura lasting', 'aura still', "aura won't go away",
      "aura hasn't gone", 'aura for hours', 'aura for over an hour', 'aura for more than an hour',
      'aura more than an hour', 'aura over an hour', "lights haven't gone away", "lights still haven't gone away",
      "lights won't go away", "zigzags won't go away", 'still seeing lights', 'still seeing zigzags',
    ],
    es: [
      'aura ya lleva', 'aura lleva', 'aura no se quita', 'aura no se va', 'aura desde hace', 'aura sigue',
      'aura todavía', 'horas con el aura', 'horas con aura', 'sigo con el aura', 'sigo viendo lucecitas',
      'sigo viendo luces', 'aura más de una hora',
    ],
    pt: [
      'aura já passa de', 'aura há mais de', 'aura há horas', 'aura faz horas', 'aura não passa',
      'aura não vai embora', 'aura continua', 'aura ainda', 'horas com a aura', 'que tô com a aura',
      'que estou com a aura', 'continuo vendo luzinhas', 'continuo vendo luzes', 'continuo com a aura',
    ],
  }),
  // Raised in code from an open episode's length, never from words.
  flag('long_attack', 'redflag.why.long', 'Does `message` say the attack has lasted more than 72 hours?', { en: [], es: [], pt: [] }),
]);

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
  combinedClassDayLimit: 10,
  combinedClasses: Object.freeze(['ergot', 'triptan', 'simple_analgesic', 'opioid'] as const),
  limits: Object.freeze({ longEpisodeHours: 12, statusHours: 72, auraMinutes: 60 }),
  redFlags,
  sleepBandHours: Object.freeze({ lt5: 4.5, '5_6': 5.5, '6_7': 6.5, '7_8': 7.5, gt8: 8.5 }),
  dayStartHour: 4,
  // About three months keeps the counts recent and still leaves room for the minimums; below one a card shows what is needed.
  insights: Object.freeze({
    windowDays: 90,
    patternChanceMax: 0.1,
    monthlyFrequency: Object.freeze({ minTrackedDays: 60, months: 6 }),
    streak: Object.freeze({ minTrackedDays: 14, staleAfterDays: 7, maxDays: 365 }),
    triggerFrequency: Object.freeze({ minEpisodes: 5, minCount: 2, top: 3 }),
    timeOfDay: Object.freeze({ minEpisodes: 8 }),
    weekday: Object.freeze({ minEpisodes: 12 }),
    helped: Object.freeze({ minDebriefs: 3, minMarked: 2, top: 5 }),
    sleepBefore: Object.freeze({
      minCheckins: 14,
      minShortNights: 5,
      minOtherNights: 5,
      minAttackDays: 3,
      shortBands: Object.freeze(['lt5', '5_6'] as const),
    }),
    timeOfDayBuckets: Object.freeze({
      night: Object.freeze([0, 6] as const),
      morning: Object.freeze([6, 12] as const),
      afternoon: Object.freeze([12, 18] as const),
      evening: Object.freeze([18, 24] as const),
    }),
  }),
});
