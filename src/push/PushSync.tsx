// Mounted while signed in and onboarded: unregisters the tokens a sign-out left behind, then registers this phone's
// token when the permission is already granted. It never asks: only "Allow notifications" does.
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';

import { useI18n } from '../i18n';
import { flushPendingUnregister, registerPush } from './pushRegistration';

export function PushSync({ userId }: { userId: string }): null {
  const { locale } = useI18n();

  // A language change runs it again, which renames the channel.
  useEffect(() => {
    void (async () => {
      await flushPendingUnregister();
      const permission = await Notifications.getPermissionsAsync().catch(() => null);
      if (permission?.granted === true) await registerPush(userId, locale);
    })();
  }, [userId, locale]);

  return null;
}
