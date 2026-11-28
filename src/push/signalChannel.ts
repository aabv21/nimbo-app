// The Android channel signal pushes arrive on. A channel's importance and lock-screen visibility can't change once it
// exists on a phone, so both are fixed here (docs/native-config.md#permissions).
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { translate } from '../i18n';
import type { Locale } from '../i18n';

/** The same id as the server's `PUSH_CHANNEL_ID` (a test keeps them equal). */
export const SIGNAL_CHANNEL_ID = 'signals';

/**
 * Creates the channel, or renames it in `locale`. The lock-screen visibility stays the system default: the copy
 * carries the privacy, and a private channel would hide even the details the user opted in to.
 */
export async function ensureSignalChannel(locale: Locale): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(SIGNAL_CHANNEL_ID, {
    name: translate(locale, 'push.channel.name'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}
