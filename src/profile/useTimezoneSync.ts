import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { deviceTimeZone } from '../lib/localDate';
import { useOnResume } from '../lib/useOnResume';
import { updateProfile } from './profileRepository';

/**
 * Keeps `profile.timezone` on the phone's zone, which the server needs to tell one local day from the
 * next. Checks on mount and on resume (a trip changes it); a zone already on its way is not sent twice.
 */
export function useTimezoneSync(): void {
  const { profile, patchProfile } = useAuth();
  const saved = profile?.timezone;
  const sending = useRef<string | null>(null);

  const sync = useCallback(() => {
    if (saved === undefined) return;
    const zone = deviceTimeZone();
    if (zone === saved || zone === sending.current) return;
    sending.current = zone;
    void updateProfile({ timezone: zone }).then((result) => {
      // A failed save is tried again on the next resume.
      if (sending.current === zone) sending.current = null;
      if (result.ok) patchProfile({ timezone: result.value.timezone });
    });
  }, [saved, patchProfile]);

  useEffect(sync, [sync]);
  useOnResume(sync);
}
