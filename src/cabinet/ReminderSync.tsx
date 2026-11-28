// Keeps the phone's preventive reminders in step with the cabinet; mounted only while a user is signed in.
import { useEffect, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { useOnResume } from '../lib/useOnResume';
import { useMedications } from './medicationStore';
import { clearReminders, onPermissionGranted, syncReminders } from './reminders';

export function ReminderSync({ userId }: { userId: string }): null {
  const { locale } = useI18n();
  const { profile } = useAuth();
  const meds = useMedications(userId);
  const detail = profile?.lockScreenDetail === true;
  // A resume (or a permission just granted) reschedules, so a one-time reminder that fired while the app was closed gives way to the next.
  const [resumes, setResumes] = useState(0);
  useOnResume(() => {
    setResumes((count) => count + 1);
  });

  // The first schedule is saved before the permission is answered, so the answer itself must trigger the sync.
  useEffect(
    () =>
      onPermissionGranted(() => {
        setResumes((count) => count + 1);
      }),
    [],
  );

  useEffect(() => {
    // NOTE: a native failure leaves the old schedule until the next change or resume; upgrade: surface it in Profile if reports show it matters.
    syncReminders(userId, meds, { detail, locale }).catch(() => undefined);
  }, [userId, meds, detail, locale, resumes]);

  // A sign-out unmounts this: nothing of the account may keep firing, least of all with its medication names.
  useEffect(
    () => () => {
      clearReminders().catch(() => undefined);
    },
    [],
  );

  return null;
}
