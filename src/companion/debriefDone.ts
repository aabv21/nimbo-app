// The attacks whose debrief was finished on this phone, kept per user under one kv key so a sign-out clears them at once.
import { kvGetJson, kvRemove, kvSet } from '../lib/kv';

/** Only recent attacks can be due, so a short list is plenty; the oldest ids drop off first. */
const KEEP = 20;

export const debriefDoneKey = (userId: string): string => `debrief.done.${userId}`;

const isIds = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The ids under kv `debrief.done.<userId>`; empty when absent or unreadable. */
export function readDebriefsDone(userId: string): ReadonlySet<string> {
  return new Set(kvGetJson(debriefDoneKey(userId), isIds) ?? []);
}

/** Adds the attack to the user's list; a backstop, so the debrief is not asked again should the server refuse its stamp. */
export function markDebriefDone(userId: string, episodeId: string): void {
  const ids = [...readDebriefsDone(userId)].filter((id) => id !== episodeId);
  kvSet(debriefDoneKey(userId), JSON.stringify([...ids, episodeId].slice(-KEEP)));
}

export function removeDebriefsDone(userId: string): void {
  kvRemove(debriefDoneKey(userId));
}
