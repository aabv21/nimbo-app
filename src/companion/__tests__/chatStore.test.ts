import { act, renderHook } from '@testing-library/react-native';

import { insertEpisode, clearLocalDb } from '../../test/localDbTest';
import { SQLiteDatabase } from '../../test/sqliteNode';
import { localDb, purgeOtherUsers, purgeUser, SCHEMA_V1 } from '../../lib/local/db';
import { enqueue } from '../../lib/outbox/outbox';
import { appendMessage, CHAT_KEEP, updateMessage, useChat } from '../chatStore';
import type { ChatMessage, ChatPayload } from '../chatStore';

// A test can hand the next `openDatabaseSync` a database it built, as a phone that already holds one would.
jest.mock('expo-sqlite', () => {
  const sqlite = require('../../test/sqliteNode') as typeof import('../../test/sqliteNode');
  const holder = globalThis as { nimboNextDb?: unknown };
  return {
    ...sqlite,
    openDatabaseSync: () => {
      const next = holder.nimboNextDb;
      holder.nimboNextDb = undefined;
      return next ?? sqlite.openDatabaseSync();
    },
  };
});

const PAYLOAD: ChatPayload = {
  drafts: [{ kind: 'dose', ref: 'd1', medicationId: '00000000-0000-4000-8000-0000000000a1', takenAt: '2026-11-27T10:00:00.000Z', episodeId: null }],
  evidence: [{ ref: 'r1', source: 'episodes', count: 4, of: 8, episodeIds: ['e1'], doseIds: [] }],
  guard: 'ok',
  replaced: null,
  confirmed: { d1: '00000000-0000-4000-8000-0000000000d1' },
};

function message(text: string, patch: Partial<Omit<ChatMessage, 'id'>> = {}): Omit<ChatMessage, 'id'> {
  return { role: 'user', text, template: null, createdAt: 1_000, status: 'sent', mode: 'chat', payload: null, ...patch };
}

function chatCount(userId: string): number {
  return localDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM chat_messages WHERE user_id = ?;', [userId])?.n ?? 0;
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(clearLocalDb);

test('a message with a payload round-trips through appendMessage and useChat', async () => {
  const chat = await renderHook(() => useChat('user-a'));
  const id = appendMessage('user-a', message('It helped', { role: 'assistant', status: 'answered', mode: 'debrief', payload: PAYLOAD, createdAt: 42 }));
  await flushMicrotasks();

  expect(chat.result.current).toEqual([
    { id, role: 'assistant', text: 'It helped', template: null, createdAt: 42, status: 'answered', mode: 'debrief', payload: PAYLOAD },
  ]);
});

test('a template message round-trips with empty text', async () => {
  appendMessage('user-a', message('', { role: 'assistant', template: 'redflag_after' }));
  const [only] = (await renderHook(() => useChat('user-a'))).result.current;
  expect(only).toEqual(expect.objectContaining({ text: '', template: 'redflag_after' }));
});

test('updateMessage changes the status and payload of the user’s own message only', async () => {
  const id = appendMessage('user-a', message('Log it', { status: 'unsent' }));
  updateMessage('user-b', id, { status: 'red_flag' });
  updateMessage('user-a', id, { status: 'replaced', payload: PAYLOAD });

  const [only] = (await renderHook(() => useChat('user-a'))).result.current;
  expect(only).toEqual(expect.objectContaining({ status: 'replaced', payload: PAYLOAD, text: 'Log it' }));
});

test('user B never reads user A’s messages', async () => {
  appendMessage('user-a', message('mine'));
  appendMessage('user-b', message('theirs'));
  expect((await renderHook(() => useChat('user-b'))).result.current.map((entry) => entry.text)).toEqual(['theirs']);
});

test(`after 205 messages only the last ${String(CHAT_KEEP)} remain, oldest first`, async () => {
  appendMessage('user-b', message('other user'));
  for (let index = 1; index <= 205; index += 1) appendMessage('user-a', message(`message ${String(index)}`));

  expect(chatCount('user-a')).toBe(200);
  expect(chatCount('user-b')).toBe(1);
  const texts = (await renderHook(() => useChat('user-a'))).result.current.map((entry) => entry.text);
  expect(texts).toHaveLength(200);
  expect(texts[0]).toBe('message 6');
  expect(texts.at(-1)).toBe('message 205');
});

test(`the table itself keeps ${String(CHAT_KEEP)} per user, so a plain insert is trimmed too`, () => {
  for (let index = 1; index <= CHAT_KEEP + 3; index += 1) {
    localDb().runSync(
      "INSERT INTO chat_messages (user_id, role, text, created_at, status, mode) VALUES ('user-a', 'user', ?, 0, 'sent', 'chat');",
      [`raw ${String(index)}`],
    );
  }
  appendMessage('user-b', message('other user'));

  expect(chatCount('user-a')).toBe(CHAT_KEEP);
  expect(chatCount('user-b')).toBe(1);
  expect(localDb().getFirstSync("SELECT text FROM chat_messages WHERE user_id = 'user-a' ORDER BY id LIMIT 1;")).toEqual({ text: 'raw 4' });
});

test('appendMessage composes inside a store transaction', () => {
  localDb().withTransactionSync(() => {
    appendMessage('user-a', message('inside'));
  });
  expect(chatCount('user-a')).toBe(1);
});

describe('the purge', () => {
  test('purgeUser removes all of the user’s chat rows even with an episode still queued, and keeps that episode', () => {
    insertEpisode('user-a', 'queued-episode');
    localDb().withTransactionSync(() => {
      enqueue('user-a', 'update_episode', { p_id: 'queued-episode', p_fields: { intensity: 5 } });
    });
    appendMessage('user-a', message('health text'));
    appendMessage('user-a', message('more health text', { status: 'unsent' }));
    appendMessage('user-b', message('stays'));

    expect(purgeUser('user-a')).toBe(false);

    expect(chatCount('user-a')).toBe(0);
    expect(chatCount('user-b')).toBe(1);
    expect(localDb().getAllSync('SELECT id FROM episodes WHERE user_id = ?;', ['user-a'])).toEqual([{ id: 'queued-episode' }]);
  });

  test('purgeOtherUsers reaches a user who has only chat rows', () => {
    appendMessage('chat-only', message('left behind'));
    purgeOtherUsers('user-a');
    expect(chatCount('chat-only')).toBe(0);
  });
});

test('a version 1 database with an episode and an outbox op opens as version 2 with both intact', () => {
  const v1 = new SQLiteDatabase();
  v1.execSync(SCHEMA_V1);
  v1.execSync('PRAGMA user_version = 1;');
  v1.runSync("INSERT INTO episodes (id, user_id, started_at, triggers, dirty) VALUES ('e1', 'user-a', '2026-11-26T10:00:00.000Z', '[\"stress\"]', 1);");
  v1.runSync(
    "INSERT INTO doses (id, user_id, medication_id, episode_id, taken_at, dirty) VALUES ('d1', 'user-a', 'm1', 'e1', '2026-11-26T10:30:00.000Z', 0);",
  );
  v1.runSync(
    "INSERT INTO outbox (user_id, kind, args, record_key, created_at) VALUES ('user-a', 'update_episode', '{\"p_id\":\"e1\",\"p_fields\":{\"intensity\":5}}', 'e1', 7);",
  );
  (globalThis as { nimboNextDb?: unknown }).nimboNextDb = v1;

  jest.isolateModules(() => {
    const db = require('../../lib/local/db') as typeof import('../../lib/local/db');
    const outbox = require('../../lib/outbox/outbox') as typeof import('../../lib/outbox/outbox');
    const chat = require('../chatStore') as typeof import('../chatStore');
    const opened = db.localDb();

    expect(opened).toBe(v1);
    expect(opened.getFirstSync<{ user_version: number }>('PRAGMA user_version;')?.user_version).toBe(2);
    expect(opened.getFirstSync('SELECT triggers, helped, did_not_help, debriefed_at, dirty FROM episodes WHERE id = ?;', ['e1'])).toEqual({
      triggers: '["stress"]',
      helped: '[]',
      did_not_help: '[]',
      debriefed_at: null,
      dirty: 1,
    });
    expect(opened.getFirstSync('SELECT helped FROM doses WHERE id = ?;', ['d1'])).toEqual({ helped: null });
    expect(outbox.listOutbox('user-a')).toEqual([
      expect.objectContaining({ kind: 'update_episode', recordKey: 'e1', args: { p_id: 'e1', p_fields: { intensity: 5 } }, createdAt: 7 }),
    ]);
    chat.appendMessage('user-a', message('after the upgrade'));
    expect(opened.getFirstSync('SELECT COUNT(*) AS n FROM chat_messages;')).toEqual({ n: 1 });
    expect(opened.getFirstSync("SELECT name FROM sqlite_master WHERE type = 'trigger';")).toEqual({ name: 'chat_messages_keep' });
  });
});
