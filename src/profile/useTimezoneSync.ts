import { useCallback, useEffect, useRef } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { deviceTimeZone } from '../lib/localDate';
import { useOnResume } from '../lib/useOnResume';
import { updateProfile } from './profileRepository';

/**
 * Keeps `profile.timezone` on the phone's zone, which the server needs to tell one local day from the
 * next. Checks on mount and on resume (a trip changes it); a zone already on its way is not sent twice,
 * and one the server refused as not an IANA name is not sent again until the device zone changes.
 */
export function useTimezoneSync(): void {
  const { profile, patchProfile } = useAuth();
  const saved = profile?.timezone;
  const sending = useRef<string | null>(null);
  const rejected = useRef<string | null>(null);

  const sync = useCallback(() => {
    if (saved === undefined) return;
    const zone = deviceTimeZone();
    if (zone === saved || zone === sending.current || zone === rejected.current) return;
    sending.current = zone;
    rejected.current = null;
    void updateProfile({ timezone: zone }).then((result) => {
      // A network or server failure is tried again on the next resume; a refused zone would only be refused again.
      if (sending.current === zone) sending.current = null;
      if (result.ok) patchProfile({ timezone: result.value.timezone });
      else if (result.kind === 'invalid') rejected.current = zone;
    });
  }, [saved, patchProfile]);

  useEffect(sync, [sync]);
  useOnResume(sync);
}
