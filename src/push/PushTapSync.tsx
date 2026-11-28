// Mounted while signed in and onboarded: a tap on a signal push opens Today. Only `data.url === '/today'` is
// followed, so a push can open nothing else; `signalId` is not read yet.
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';

function opensToday(response: Notifications.NotificationResponse): boolean {
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return false;
  return response.notification.request.content.data?.url === '/today';
}

export function PushTapSync(): null {
  useEffect(() => {
    function open(response: Notifications.NotificationResponse | null): void {
      if (response === null || !opensToday(response)) return;
      // Cleared so a later remount (another sign-in) doesn't follow the same tap again.
      Notifications.clearLastNotificationResponse();
      router.navigate('/today');
    }
    // A tap that launched the app arrived before this listener existed.
    open(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}
