// The companion chat on the phone: health text kept here only, never queued or synced, and purged at sign-out.
// Each write is one statement with no transaction of its own, so a store transaction can include it.
import { useCallback } from 'react';

import { localDb, notifyChanged } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import type { Draft, Evidence, Guard, Mode, ReplacedReason } from './contract';

export type ChatStatus = 'sent' | 'unsent' | 'answered' | 'replaced' | 'red_flag';

/** Assistant lines the app writes itself, stored as keys so they follow the UI language: `companion.redflag.after`, `debrief.done`. */
export type ChatTemplate = 'redflag_after' | 'debrief_done';

export interface ChatPayload {
  drafts: readonly Draft[];
  evidence: readonly Evidence[];
  guard: Guard;
  replaced: ReplacedReason | null;
  /** Draft ref → the record id made on its first Confirm, so a second Confirm writes nothing. */
  confirmed: Readonly<Record<string, string>>;
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  /** Empty for a `template` line. */
  text: string;
  template: ChatTemplate | null;
  /** Epoch milliseconds. */
  createdAt: number;
  status: ChatStatus;
  mode: Mode;
  payload: ChatPayload | null;
}

/**
 * Older messages are deleted past this many per user: the chat is a working memory, not a record. The
 * `chat_messages_keep` trigger in `src/lib/local/db.ts` holds the same number; changing it is a new schema step.
 */
export const CHAT_KEEP = 200;

interface ChatRow {
  id: number;
  role: ChatMessage['role'];
  text: string;
  template: ChatTemplate | null;
  created_at: number;
  status: ChatStatus;
  mode: Mode;
  payload: string | null;
}

function toMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    template: row.template,
    createdAt: row.created_at,
    status: row.status,
    mode: row.mode,
    payload: row.payload === null ? null : (JSON.parse(row.payload) as ChatPayload),
  };
}

/** After the write commits, like `enqueue`: a caller's transaction that rolls back leaves no stale read behind. */
function announce(): void {
  queueMicrotask(() => {
    notifyChanged(['chat_messages']);
  });
}

/** Stores the message and returns its id; the table's trigger deletes the user's messages past `CHAT_KEEP`. */
export function appendMessage(userId: string, message: Omit<ChatMessage, 'id'>): number {
  const { lastInsertRowId } = localDb().runSync(
    'INSERT INTO chat_messages (user_id, role, text, template, created_at, status, mode, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
    [
      userId,
      message.role,
      message.text,
      message.template,
      message.createdAt,
      message.status,
      message.mode,
      message.payload === null ? null : JSON.stringify(message.payload),
    ],
  );
  announce();
  return lastInsertRowId;
}

/** Changes the status or payload of one of the user's messages; another user's id is a no-op. */
export function updateMessage(userId: string, id: number, change: Partial<Pick<ChatMessage, 'status' | 'payload'>>): void {
  const sets: string[] = [];
  const values: (string | null)[] = [];
  if (change.status !== undefined) {
    sets.push('status = ?');
    values.push(change.status);
  }
  if (change.payload !== undefined) {
    sets.push('payload = ?');
    values.push(change.payload === null ? null : JSON.stringify(change.payload));
  }
  if (sets.length === 0) return;
  // The SET list holds only the two fixed column names above.
  localDb().runSync(`UPDATE chat_messages SET ${sets.join(', ')} WHERE id = ? AND user_id = ?;`, [...values, id, userId]);
  announce();
}

/** The user's last `CHAT_KEEP` messages, oldest first. */
export function useChat(userId: string): readonly ChatMessage[] {
  const read = useCallback(
    () =>
      localDb()
        .getAllSync<ChatRow>(
          'SELECT id, role, text, template, created_at, status, mode, payload FROM chat_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?;',
          [userId, CHAT_KEEP],
        )
        .map(toMessage)
        .reverse(),
    [userId],
  );
  return useLocalQuery(['chat_messages'], read);
}
