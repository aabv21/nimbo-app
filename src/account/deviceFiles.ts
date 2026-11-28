// The files a signed-in account leaves on the phone outside the local store: the export in the cache directory and the
// reminders the phone scheduled.
import { File, Paths } from 'expo-file-system';

import { clearReminders } from '../cabinet/reminders';

const EXPORT_FILE = /^nimbo-data-.*\.json$/;

/** Removes every "Export my data" file left in the cache directory (it holds health data). */
export function removeExports(): void {
  for (const entry of Paths.cache.list()) {
    if (entry instanceof File && EXPORT_FILE.test(entry.name)) entry.delete();
  }
}

/** After a confirmed deletion. Best effort, each step on its own: a failure leaves that copy but never stops the rest. */
export async function forgetDeviceFiles(): Promise<void> {
  try {
    removeExports();
  } catch {
    // The cache directory is the OS's to purge; the next export replaces whatever stayed.
  }
  // Through `then`, so a call that throws instead of rejecting is settled as well.
  await Promise.resolve()
    .then(clearReminders)
    .catch(() => undefined);
}
