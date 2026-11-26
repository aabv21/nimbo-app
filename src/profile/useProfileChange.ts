import { useCallback, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import type { RequestErrorKind } from '../lib/requestResult';
import { updateProfile } from './profileRepository';
import type { EditableProfile, Profile } from './profileRepository';

type Changes = Partial<EditableProfile>;

function pick(source: Profile, keys: readonly string[]): Changes {
  const values = new Map<string, unknown>(Object.entries(source));
  return Object.fromEntries(keys.map((key) => [key, values.get(key)]));
}

/**
 * Applies a preference at once (the theme re-renders before the server answers), then saves it; a
 * failed save puts the previous values back and keeps the failure's kind for the screen to show.
 * Answers can arrive out of order, so a write settles only the fields no later change has touched.
 */
export function useProfileChange(): { change: (changes: Changes) => Promise<boolean>; error: RequestErrorKind | undefined } {
  const { profile, patchProfile } = useAuth();
  const [error, setError] = useState<RequestErrorKind | undefined>(undefined);
  const latest = useRef(new Map<string, number>());
  const sequence = useRef(0);

  const change = useCallback(
    async (changes: Changes): Promise<boolean> => {
      if (profile === null) return false;
      sequence.current += 1;
      const mine = sequence.current;
      const keys = Object.keys(changes);
      for (const key of keys) latest.current.set(key, mine);

      setError(undefined);
      patchProfile(changes);
      const result = await updateProfile(changes);

      const current = keys.filter((key) => latest.current.get(key) === mine);
      if (result.ok) {
        if (current.length > 0) patchProfile(pick(result.value, current));
        return true;
      }
      if (current.length > 0) {
        // `profile` is the snapshot from before this change: its values are the ones to put back.
        patchProfile(pick(profile, current));
        setError(result.kind);
      }
      return false;
    },
    [profile, patchProfile],
  );

  return { change, error };
}
