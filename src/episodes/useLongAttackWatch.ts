// The duration red flag: an attack still open after the pack's status hours opens urgent care, once per attack.
import { usePathname } from 'expo-router';
import { useCallback, useEffect } from 'react';

import { packs } from '../condition';
import { kvGet, kvSet } from '../lib/kv';
import { useOnResume } from '../lib/useOnResume';
import { currentUrgentCare, showUrgentCare } from '../redflags/urgentCare';
import { readOpenEpisode } from './episodeStore';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Set once the screen opened for that attack, so neither a resume nor a relaunch opens it again. The user id segment
 * lets the sign-out and deletion sweeps find it.
 */
export function longAttackKey(userId: string, episodeId: string): string {
  return `redflag.long.${userId}.${episodeId}`;
}

/** Checks on mount and on every return to the foreground; mount it once, in the signed-in tree. */
export function useLongAttackWatch(userId: string | null): void {
  // At launch the landing route `/` redirects with a replace, which would drop a screen pushed before it.
  const ready = usePathname() !== '/';

  const check = useCallback(() => {
    if (userId === null || !ready) return;
    const episode = readOpenEpisode(userId);
    if (episode === null || kvGet(longAttackKey(userId, episode.id)) !== null) return;
    if (Date.now() - new Date(episode.startedAt).getTime() < packs.migraine.limits.statusHours * HOUR_MS) return;
    // Another urgent-care screen is up: this one would stack on it, so it waits for the next check.
    if (currentUrgentCare() !== null) return;
    showUrgentCare({ flags: ['long_attack'], source: 'duration', excerpt: null, episodeId: episode.id });
    kvSet(longAttackKey(userId, episode.id), new Date().toISOString());
  }, [userId, ready]);

  useEffect(check, [check]);
  useOnResume(check);
}
