// The companion's notes about the user. Only the `companion` function writes them, so the phone reads them online
// and keeps a per-user copy for an offline view; there is no outbox for notes.
import type { Client } from '../auth/emailAuth';
import { kvGetJson, kvRemove, kvSet } from '../lib/kv';
import { toRequestErrorKind, toThrownErrorKind } from '../lib/requestResult';
import type { RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';

export interface AgentNote {
  id: string;
  text: string;
  createdAt: string;
}

// Row-level security scopes the read to the signed-in user's own notes, as for the profile.
const COLUMNS = 'id,text,created_at';

function cacheKey(userId: string): string {
  return `memory.${userId}`;
}

function isNoteList(value: unknown): value is AgentNote[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false;
      const note = item as Record<string, unknown>;
      return typeof note['id'] === 'string' && typeof note['text'] === 'string' && typeof note['createdAt'] === 'string';
    })
  );
}

/** `userId`'s notes from their last online read, newest first; null when there is none (or it is unreadable). */
export function readCachedNotes(userId: string): AgentNote[] | null {
  return kvGetJson(cacheKey(userId), isNoteList);
}

export function writeCachedNotes(userId: string, notes: readonly AgentNote[]): void {
  kvSet(cacheKey(userId), JSON.stringify(notes));
}

/** Only the sign-out cleanup in `SyncProvider` calls this. */
export function removeCachedNotes(userId: string): void {
  kvRemove(cacheKey(userId));
}

/** Newest first. Never caches: the caller knows whether the account that asked is still the signed-in one. */
export async function fetchAgentNotes(client: Client = supabase): Promise<RequestResult<AgentNote[]>> {
  try {
    const { data, error, status } = await client.from('agent_notes').select(COLUMNS).order('created_at', { ascending: false });
    if (error !== null) return { ok: false, kind: toRequestErrorKind(error, status) };
    return { ok: true, value: data.map((row) => ({ id: row.id, text: row.text, createdAt: row.created_at })) };
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }
}

/** A missing or foreign id is a no-op on the server, so a repeated delete succeeds. */
export async function deleteAgentNote(id: string, client: Client = supabase): Promise<RequestResult<void>> {
  try {
    const { error, status } = await client.rpc('delete_agent_note', { p_id: id });
    if (error !== null) return { ok: false, kind: toRequestErrorKind(error, status) };
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }
}
