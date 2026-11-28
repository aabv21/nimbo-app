// The signal pushes' copy in the profile's language; the app's own strings live in src/i18n, and a test keeps the
// shared ones equal. Without the lock-screen opt-in a push says only the neutral line (docs/database.md#push-tokens).

import { packs } from './condition/index.ts';
import type { Locale, SleepBand } from './condition/types.ts';
import type { QuietStretch, Signal } from './signals.ts';

export type PushCopy = { title: string; body?: string };

/** `push.neutral`: the whole push when the user has not opted in to details. */
export const NEUTRAL: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'You have a note from Nimbo',
  es: 'Tienes una nota de Nimbo',
  pt: 'Você tem uma nota do Nimbo',
});

type TitleKey = 'long_attack' | 'overuse' | 'debrief' | 'short_sleep' | 'pressure' | 'quiet';

/** `signal.<key>.title`, the same text as the app's catalogs. */
export const TITLES: Readonly<Record<Locale, Readonly<Record<TitleKey, string>>>> = Object.freeze({
  en: {
    long_attack: 'Long attack',
    overuse: 'Medication days',
    debrief: 'Debrief for yesterday’s attack',
    short_sleep: 'Short night',
    pressure: 'Pressure change',
    quiet: 'No check-in lately',
  },
  es: {
    long_attack: 'Crisis larga',
    overuse: 'Días con medicación',
    debrief: 'Repaso de la crisis de ayer',
    short_sleep: 'Noche corta',
    pressure: 'Cambio de presión',
    quiet: 'Sin check-in estos días',
  },
  pt: {
    long_attack: 'Crise longa',
    overuse: 'Dias com medicação',
    debrief: 'Revisão da crise de ontem',
    short_sleep: 'Noite curta',
    pressure: 'Mudança de pressão',
    quiet: 'Sem check-in nos últimos dias',
  },
});

const SLEPT: Readonly<Record<Locale, Readonly<Record<SleepBand, string>>>> = Object.freeze({
  en: { lt5: 'You slept under 5 h', '5_6': 'You slept 5 to 6 h', '6_7': 'You slept 6 to 7 h', '7_8': 'You slept 7 to 8 h', gt8: 'You slept over 8 h' },
  es: { lt5: 'Dormiste menos de 5 h', '5_6': 'Dormiste de 5 a 6 h', '6_7': 'Dormiste de 6 a 7 h', '7_8': 'Dormiste de 7 a 8 h', gt8: 'Dormiste más de 8 h' },
  pt: {
    lt5: 'Você dormiu menos de 5 h',
    '5_6': 'Você dormiu de 5 a 6 h',
    '6_7': 'Você dormiu de 6 a 7 h',
    '7_8': 'Você dormiu de 7 a 8 h',
    gt8: 'Você dormiu mais de 8 h',
  },
});

type Bodies = {
  longAttack: (hours: string) => string;
  overuse: (days: string, limit: string) => string;
  debrief: string;
  shortSleep: (slept: string) => string;
  pressure: (hpa: string) => string;
  quiet: (days: string, one: boolean, over: boolean) => string;
};

const BODIES: Readonly<Record<Locale, Bodies>> = Object.freeze({
  en: {
    longAttack: (hours) => `Your attack has been going for ${hours} h.`,
    overuse: (days, limit) => `${days} of ${limit} days this month.`,
    debrief: 'Three short questions about yesterday.',
    shortSleep: (slept) => `${slept}, under your average before an attack.`,
    pressure: (hpa) => `Pressure drops ${hpa} hPa over the next 24 h.`,
    quiet: (days, one, over) => `No check-in for ${over ? 'over ' : ''}${days} ${one ? 'day' : 'days'}.`,
  },
  es: {
    longAttack: (hours) => `Tu crisis lleva ${hours} h.`,
    overuse: (days, limit) => `${days} de ${limit} días este mes.`,
    debrief: 'Tres preguntas cortas sobre ayer.',
    shortSleep: (slept) => `${slept}, menos que tu media antes de una crisis.`,
    pressure: (hpa) => `La presión baja ${hpa} hPa en las próximas 24 h.`,
    quiet: (days, one, over) => `Sin check-in desde hace ${over ? 'más de ' : ''}${days} ${one ? 'día' : 'días'}.`,
  },
  pt: {
    longAttack: (hours) => `Sua crise já dura ${hours} h.`,
    overuse: (days, limit) => `${days} de ${limit} dias este mês.`,
    debrief: 'Três perguntas curtas sobre ontem.',
    shortSleep: (slept) => `${slept}, abaixo da sua média antes de uma crise.`,
    pressure: (hpa) => `A pressão cai ${hpa} hPa nas próximas 24 h.`,
    quiet: (days, one, over) => `Sem check-in há ${over ? 'mais de ' : ''}${days} ${one ? 'dia' : 'dias'}.`,
  },
});

/** The profile language, English when unset or unknown. */
export function pushLanguageOf(value: unknown): Locale {
  return value === 'es' || value === 'pt' ? value : 'en';
}

const formats = new Map<Locale, Intl.NumberFormat>();

/** At most one decimal, in the language's separator (6.5 / 6,5). */
function number(value: number, language: Locale): string {
  let format = formats.get(language);
  if (format === undefined) {
    format = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
    formats.set(language, format);
  }
  return format.format(value);
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

function isOne(value: number, language: Locale): boolean {
  let rules = pluralRules.get(language);
  if (rules === undefined) {
    rules = new Intl.PluralRules(language);
    pluralRules.set(language, rules);
  }
  return rules.select(value) === 'one';
}

/**
 * The push for `signal`: without `detail` only the neutral title, whatever the kind; with it, the kind's title and a
 * body that never names a medication or its class. Quiet tracker states `quiet` (`quietDaysOf`), so a push held back
 * by the window or the cap still counts right; without it, the rule's threshold, which the stretch has reached.
 */
export function signalPushCopy(signal: Signal, language: Locale, detail: boolean, quiet?: QuietStretch): PushCopy {
  if (!detail) return { title: NEUTRAL[language] };
  const titles = TITLES[language];
  const bodies = BODIES[language];
  const n = (value: number): string => number(value, language);
  switch (signal.kind) {
    case 'long_attack':
      return { title: titles.long_attack, body: bodies.longAttack(n(signal.evidence.hoursOpen)) };
    case 'overuse_warn':
    case 'overuse_limit':
      return { title: titles.overuse, body: bodies.overuse(n(signal.evidence.days), n(signal.evidence.limit)) };
    case 'debrief_due':
      return { title: titles.debrief, body: bodies.debrief };
    case 'short_sleep':
      return { title: titles.short_sleep, body: bodies.shortSleep(SLEPT[language][signal.evidence.sleepBand]) };
    case 'pressure':
      return { title: titles.pressure, body: bodies.pressure(n(signal.evidence.dropHpa)) };
    case 'quiet_tracker': {
      const { days, over } = quiet ?? { days: packs.migraine.signals.quietTrackerDays, over: false };
      return { title: titles.quiet, body: bodies.quiet(n(days), isOne(days, language), over) };
    }
  }
}
