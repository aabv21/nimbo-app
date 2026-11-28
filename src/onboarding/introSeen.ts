// Whether this phone has shown the intro: device-wide, so a sign-out or another account never replays it.
import { kvGet, kvSet } from '../lib/kv';

const KEY = 'intro.seen';

export function readIntroSeen(): boolean {
  return kvGet(KEY) !== null;
}

export function markIntroSeen(): void {
  kvSet(KEY, new Date().toISOString());
}
