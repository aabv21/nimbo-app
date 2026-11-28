// Shared by the suites that run the local store on `sqliteNode.ts`: an empty store per test and
// mirror rows inserted the way a repository would.
import { localDb } from '../lib/local/db';

export function clearLocalDb(): void {
  localDb().execSync('DELETE FROM outbox; DELETE FROM episodes; DELETE FROM medications; DELETE FROM doses; DELETE FROM checkins; DELETE FROM chat_messages;');
}

export function insertEpisode(userId: string, id: string, startedAt = '2026-11-27T10:00:00.000Z'): void {
  localDb().runSync('INSERT INTO episodes (id, user_id, started_at) VALUES (?, ?, ?);', [id, userId, startedAt]);
}

export function dirtyOf(table: 'episodes' | 'checkins', key: string): number | undefined {
  const where = table === 'checkins' ? 'local_date = ?' : 'id = ?';
  // `table` is one of two literals, never input.
  return localDb().getFirstSync<{ dirty: number }>(`SELECT dirty FROM ${table} WHERE ${where};`, [key])?.dirty;
}
