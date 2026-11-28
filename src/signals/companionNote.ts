// The companion's note on Today: template text from code, never a model call, picked by what matters most now.
// The order and the copy: docs/architecture.md#todays-companion-note.
import type { Locale } from '../condition';
import type { Translate, TranslatePlural } from '../i18n';
import type { Signal } from './index';
import { clockIn } from './signalText';

export type NoteState = { kind: 'during' } | { kind: 'signal'; signal: Signal } | { kind: 'first' };

/** An open attack first, then Today's top signal, then a word for a brand-new user; otherwise no note. */
export function companionNote(input: { openEpisode: boolean; rows: readonly Signal[]; hasRecords: boolean }): NoteState | null {
  if (input.openEpisode) return { kind: 'during' };
  const [top] = input.rows;
  if (top !== undefined) return { kind: 'signal', signal: top };
  return input.hasRecords ? null : { kind: 'first' };
}

export interface NoteContext {
  t: Translate;
  tp: TranslatePlural;
  locale: Locale;
  timeZone: string;
}

/** The note's text, and the count line under it when the signal rests on a count. */
export function noteText(state: NoteState, ctx: NoteContext): { text: string; count: string | null } {
  const { t, tp } = ctx;
  if (state.kind === 'during') return { text: t('today.note.during'), count: null };
  if (state.kind === 'first') return { text: t('today.note.first'), count: null };
  const { signal } = state;
  switch (signal.kind) {
    case 'short_sleep':
      return {
        text: t('today.note.short_sleep', { slept: t(`signal.sleep.slept.${signal.evidence.sleepBand}`) }),
        count: tp('today.note.count.short_sleep', signal.evidence.attackNights),
      };
    case 'pressure':
      return { text: t('today.note.pressure', { hpa: signal.evidence.dropHpa }), count: null };
    case 'overuse_warn':
    case 'overuse_limit':
      return { text: t(`today.note.${signal.kind}`, { days: signal.evidence.days, limit: signal.evidence.limit }), count: null };
    case 'debrief_due':
      return { text: t('today.note.debrief', { time: clockIn(signal.evidence.endedAt, ctx.timeZone, ctx.locale) }), count: null };
    case 'quiet_tracker':
      return { text: t('today.note.quiet'), count: null };
    case 'long_attack':
      // Only an open attack is long, and an open attack already gives the "during" note.
      return { text: t('today.note.during'), count: null };
  }
}
