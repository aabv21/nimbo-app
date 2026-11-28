// A signal's words for its Today row: title and reason on the row, then the detail, source and action it opens to.
// Every number comes from the signal's evidence; nothing here guesses or scores.
import { classLabelKey } from '../cabinet/medicationLabels';
import type { Locale } from '../condition';
import type { Translate, TranslatePlural } from '../i18n';
import { formatClock } from '../i18n/format';
import type { Signal } from './index';

export type SignalActionKind = 'debrief' | 'crisis' | 'checkin' | 'cabinet';

export interface SignalText {
  title: string;
  reason: string;
  detail: string;
  source: string;
  action: { label: string; kind: SignalActionKind } | null;
  /** The weather provider's credit, which its terms ask for wherever its data shows. */
  attribution: boolean;
}

export interface SignalTextContext {
  t: Translate;
  tp: TranslatePlural;
  locale: Locale;
  knownTriggers: readonly string[];
  timeZone: string;
}

const clockFormats = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock time of `iso` in `timeZone`, written the app's way (`formatClock`). */
export function clockIn(iso: string, timeZone: string, locale: Locale): string {
  let format = clockFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
    clockFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(iso));
  const part = (type: string): number => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return formatClock(new Date(2000, 0, 1, part('hour'), part('minute')), locale);
}

export function signalText(signal: Signal, { t, tp, locale, knownTriggers, timeZone }: SignalTextContext): SignalText {
  const plain = { action: null, attribution: false };
  switch (signal.kind) {
    case 'pressure': {
      const { dropHpa, nowHpa, laterHpa, laterAt } = signal.evidence;
      return {
        title: t('signal.pressure.title'),
        // Chosen at onboarding, or only tagged on attacks: the reason says which, never more.
        reason: t(knownTriggers.includes('weather') ? 'signal.pressure.reason' : 'signal.pressure.reason_tagged', { hpa: dropHpa }),
        // Strings, so a four-digit pressure is never grouped ("1,012").
        detail: t('signal.pressure.detail', { now: String(nowHpa), later: String(laterHpa), time: clockIn(laterAt, timeZone, locale) }),
        source: t('signal.pressure.source'),
        action: null,
        attribution: true,
      };
    }
    case 'short_sleep': {
      const { sleepBand, avgAttackNightHours, attackNights } = signal.evidence;
      return {
        ...plain,
        title: t('signal.short_sleep.title'),
        reason: t('signal.short_sleep.reason', { slept: t(`signal.sleep.slept.${sleepBand}`) }),
        detail: tp('signal.short_sleep.detail', attackNights, { avg: t('insight.sleep.hours', { h: avgAttackNightHours }) }),
        source: t('signal.short_sleep.source'),
      };
    }
    case 'overuse_warn':
    case 'overuse_limit': {
      const { scope, days, limit } = signal.evidence;
      const label = t(scope === 'combined' ? 'overuse.class.combined' : classLabelKey(scope));
      return {
        title: t('signal.overuse.title'),
        reason: t(signal.kind === 'overuse_limit' ? 'signal.overuse.reason_limit' : 'signal.overuse.reason_warn', { days, limit, class: label }),
        detail: t('signal.overuse.detail'),
        source: t('signal.overuse.source'),
        action: { label: t('overuse.limit.action'), kind: 'cabinet' },
        attribution: false,
      };
    }
    case 'long_attack':
      return {
        title: t('signal.long_attack.title'),
        reason: t('signal.long_attack.reason', { hours: signal.evidence.hoursOpen }),
        detail: t('signal.long_attack.detail'),
        source: t('signal.long_attack.source'),
        action: { label: t('today.resume'), kind: 'crisis' },
        attribution: false,
      };
    case 'debrief_due':
      return {
        title: t('signal.debrief.title'),
        reason: t('signal.debrief.reason', { time: clockIn(signal.evidence.endedAt, timeZone, locale) }),
        detail: t('signal.debrief.detail'),
        source: t('signal.debrief.source'),
        action: { label: t('signal.debrief.action'), kind: 'debrief' },
        attribution: false,
      };
    case 'quiet_tracker':
      return {
        title: t('signal.quiet.title'),
        reason: t('signal.quiet.reason'),
        detail: t('signal.quiet.detail'),
        source: t('signal.quiet.source'),
        action: { label: t('signal.quiet.action'), kind: 'checkin' },
        attribution: false,
      };
  }
}
