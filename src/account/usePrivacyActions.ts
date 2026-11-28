// "Export my data" and "Delete my account" for one signed-in account: the file in the cache directory and its share
// sheet, and the deletion flow with its messages. The flows: docs/app.md#account-deletion-on-the-phone.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert } from 'react-native';

import { useI18n } from '../i18n';
import { kvUserRefused } from '../lib/kv';
import { readStoredSession } from '../lib/supabase';
import type { MessageKey } from '../i18n';
import { useSyncState } from '../lib/sync/SyncProvider';
import { exportData, exportFileName } from './accountClient';
import { deletionMessage, runDeletion, sessionStillFor } from './deletionFlow';
import { removeExports } from './deviceFiles';

type Action = { run: () => void; busy: boolean; error: MessageKey | undefined };

/** Still this account's to write: not deleted on this phone and still the stored session's, so a late answer is dropped. */
function stillSignedIn(userId: string): boolean {
  try {
    return !kvUserRefused(userId) && readStoredSession()?.userId === userId;
  } catch {
    return false;
  }
}

/** Keeps state updates off a screen that unmounted mid-request (a deletion signs out). */
function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/**
 * One flow at a time, from an export's start or a delete tap until it ends. Any export failure (function, file or
 * share sheet) shows one message; `reauth` is an Alert, since the local sign-out takes the screen away; other deletion
 * failures stay on the screen with their message. Neither the file's name nor its content is ever logged.
 */
export function usePrivacyActions(userId: string): {
  exporting: Action & { fileUri: string | null; share: () => void };
  deleting: Action;
} {
  const { t } = useI18n();
  const { outboxFor } = useSyncState();
  const mounted = useMounted();
  const active = useRef(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState<MessageKey | undefined>(undefined);
  const [fileUri, setFileUri] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<MessageKey | undefined>(undefined);

  const failExport = useCallback(() => {
    setExportError('export.error');
    AccessibilityInfo.announceForAccessibility(t('export.error'));
  }, [t]);

  const runExport = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setExportError(undefined);
    setExportBusy(true);
    void (async () => {
      let uri: string | null = null;
      try {
        const outcome = await exportData();
        // Signed out, deleted or left meanwhile: the health data is dropped, never written to a file.
        if (outcome.ok && mounted.current && stillSignedIn(userId)) {
          // Only the newest copy of the data stays in the cache directory.
          removeExports();
          const file = new File(Paths.cache, exportFileName());
          await file.write(outcome.json);
          uri = file.uri;
        }
      } catch {
        uri = null;
      }
      active.current = false;
      if (!mounted.current) return;
      setExportBusy(false);
      setFileUri(uri);
      if (uri === null) failExport();
      else AccessibilityInfo.announceForAccessibility(t('export.ready'));
    })();
  }, [userId, t, mounted, failExport]);

  const share = useCallback(() => {
    if (fileUri === null || active.current) return;
    active.current = true;
    setExportError(undefined);
    void (async () => {
      let shared = false;
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: t('export.title') });
          shared = true;
        }
      } catch {
        shared = false;
      }
      active.current = false;
      if (mounted.current && !shared) failExport();
    })();
  }, [fileUri, t, mounted, failExport]);

  const runDelete = useCallback(() => {
    if (active.current) return;
    active.current = true;
    setDeleteError(undefined);
    setDeleteBusy(true);
    void (async () => {
      const result = await runDeletion(userId, outboxFor(userId));
      active.current = false;
      const message = deletionMessage(result);
      if (result === 'reauth' && message !== undefined) {
        // Never shown to another account that signed in while the request was out.
        if (sessionStillFor(userId)) {
          Alert.alert(t(message));
          AccessibilityInfo.announceForAccessibility(t(message));
        }
        if (mounted.current) setDeleteBusy(false);
        return;
      }
      if (!mounted.current) return;
      setDeleteBusy(false);
      if (message !== undefined) {
        setDeleteError(message);
        AccessibilityInfo.announceForAccessibility(t(message));
      }
    })();
  }, [userId, outboxFor, mounted, t]);

  return {
    exporting: { run: runExport, busy: exportBusy, error: exportError, fileUri, share },
    deleting: { run: runDelete, busy: deleteBusy, error: deleteError },
  };
}
