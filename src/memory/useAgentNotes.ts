// The agent's notes for one signed-in user: the cached copy at once, then the server's on every focus and resume.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { currentUserId } from '../auth/currentUser';
import type { RequestErrorKind } from '../lib/requestResult';
import { useOnResume } from '../lib/useOnResume';
import { deleteAgentNote, fetchAgentNotes, readCachedNotes, writeCachedNotes } from './agentNotesRepository';
import type { AgentNote } from './agentNotesRepository';

export interface AgentNotes {
  /** Newest first; null while there is neither a cached copy nor an answer. */
  notes: readonly AgentNote[] | null;
  /** This visit's read succeeded, so what is shown is the server's list and a delete can be tried. */
  live: boolean;
  /** Why the last read failed; the cached copy, if any, stays shown. */
  readError: RequestErrorKind | undefined;
  deleteFailed: boolean;
  /** Removes the note at once; a failed delete puts it back and sets `deleteFailed`. */
  forget: (note: AgentNote) => void;
}

interface Shown {
  notes: readonly AgentNote[] | null;
  live: boolean;
  readError: RequestErrorKind | undefined;
}

function newestFirst(a: AgentNote, b: AgentNote): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Bound to one account for its whole life: callers key it by `userId`, so a switch starts from the new account's
 * own cache. An answer that settles after the account changed is dropped, so it is never shown or cached.
 */
export function useAgentNotes(userId: string): AgentNotes {
  const [shown, setShown] = useState<Shown>(() => ({ notes: readCachedNotes(userId), live: false, readError: undefined }));
  const [deleteFailed, setDeleteFailed] = useState(false);
  // Deleted here (or on their way): a read that started before the delete still lists them.
  const hidden = useRef(new Set<string>());
  const reads = useRef(0);

  const refresh = useCallback(() => {
    reads.current += 1;
    const read = reads.current;
    void fetchAgentNotes().then((result) => {
      if (read !== reads.current || currentUserId() !== userId) return;
      if (!result.ok) {
        setShown((previous) => ({ ...previous, live: false, readError: result.kind }));
        return;
      }
      setShown({ notes: result.value.filter((note) => !hidden.current.has(note.id)), live: true, readError: undefined });
    });
  }, [userId]);

  useFocusEffect(refresh);
  useOnResume(refresh);

  // The offline copy follows what a live list shows; the sign-out cleanup in `SyncProvider` removes it.
  useEffect(() => {
    if (shown.live && shown.notes !== null && currentUserId() === userId) writeCachedNotes(userId, shown.notes);
  }, [shown, userId]);

  const live = shown.live;
  const forget = useCallback(
    (note: AgentNote) => {
      if (!live) return;
      hidden.current.add(note.id);
      setDeleteFailed(false);
      setShown((previous) => ({ ...previous, notes: (previous.notes ?? []).filter((item) => item.id !== note.id) }));
      void deleteAgentNote(note.id).then((result) => {
        if (result.ok || currentUserId() !== userId) return;
        hidden.current.delete(note.id);
        setDeleteFailed(true);
        setShown((previous) => ({
          ...previous,
          notes: [...(previous.notes ?? []).filter((item) => item.id !== note.id), note].sort(newestFirst),
        }));
      });
    },
    [live, userId],
  );

  return { notes: shown.notes, live: shown.live, readError: shown.readError, deleteFailed, forget };
}
