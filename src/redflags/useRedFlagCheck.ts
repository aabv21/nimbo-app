// Every free text the user enters goes through this first: on the phone, offline, with or without the AI.
import { useCallback } from 'react';

import { matchRedFlagsAnyLocale, packs } from '../condition';
import { showUrgentCare } from './urgentCare';

const EXCERPT_MAX = 160;

/** The first sentence that hit, so a long message shows the part that matters; cut to fit the screen. */
export function excerptOf(text: string): string {
  const sentences = (text.match(/[^.!?…\n]+[.!?…]*/g) ?? []).map((sentence) => sentence.trim());
  const hit = sentences.find((sentence) => matchRedFlagsAnyLocale(sentence, packs.migraine).length > 0) ?? text.trim();
  return hit.length > EXCERPT_MAX ? `${hit.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : hit;
}

/**
 * Matches every language's keywords, whatever the app's: people write in the language they think in,
 * and a miss costs more than a rare false hit. True when it opened the urgent-care screen.
 */
export function useRedFlagCheck(): (text: string, source: 'text' | 'voice') => boolean {
  return useCallback((text: string, source: 'text' | 'voice'): boolean => {
    const flags = matchRedFlagsAnyLocale(text, packs.migraine);
    if (flags.length === 0) return false;
    showUrgentCare({ flags, excerpt: excerptOf(text), source, episodeId: null });
    return true;
  }, []);
}
