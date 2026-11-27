// The repository against a real supabase-js client with a fake fetch, so the assertions are on the requests it sends.
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

import { createClient } from '@supabase/supabase-js';

import type { Client } from '../../auth/emailAuth';
import type { Database } from '../../lib/database.types';
import { kvGet, kvSet } from '../../lib/kv';
import { deleteAgentNote, fetchAgentNotes, readCachedNotes, writeCachedNotes } from '../agentNotesRepository';

const SUPABASE_URL = 'http://127.0.0.1:54521';

interface Sent {
  url: URL;
  method: string | undefined;
  body: unknown;
}

/** A client whose every request answers `status` and `body`; `sent` records what it was asked. */
function clientAnswering(status: number, body: unknown): { client: Client; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    sent.push({ url: new URL(url), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  };
  const client = createClient<Database, 'public'>(SUPABASE_URL, 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { client, sent };
}

function only(sent: readonly Sent[]): Sent {
  const [first, ...rest] = sent;
  if (first === undefined || rest.length > 0) throw new Error(`expected one request, got ${String(sent.length)}`);
  return first;
}

test('the notes are read with an explicit column list, newest first', async () => {
  const { client, sent } = clientAnswering(200, [
    { id: 'n2', text: 'Works night shifts on Thursdays', created_at: '2026-11-20T10:00:00Z' },
    { id: 'n1', text: 'Prefers short answers', created_at: '2026-11-10T10:00:00Z' },
  ]);

  const result = await fetchAgentNotes(client);

  const { url, method } = only(sent);
  expect(method).toBe('GET');
  expect(url.pathname).toBe('/rest/v1/agent_notes');
  expect(url.searchParams.get('select')).toBe('id,text,created_at');
  expect(url.searchParams.get('order')).toBe('created_at.desc');
  expect(result).toEqual({
    ok: true,
    value: [
      { id: 'n2', text: 'Works night shifts on Thursdays', createdAt: '2026-11-20T10:00:00Z' },
      { id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' },
    ],
  });
});

test('a delete calls delete_agent_note with the note id', async () => {
  const { client, sent } = clientAnswering(204, null);

  const result = await deleteAgentNote('n1', client);

  const { url, method, body } = only(sent);
  expect(url.pathname).toBe('/rest/v1/rpc/delete_agent_note');
  expect(method).toBe('POST');
  expect(body).toEqual({ p_id: 'n1' });
  expect(result).toEqual({ ok: true, value: undefined });
});

test('a refused delete is a failure the screen can show', async () => {
  const { client } = clientAnswering(401, { code: '42501', message: 'not signed in' });

  expect(await deleteAgentNote('n1', client)).toEqual({ ok: false, kind: 'unknown' });
});

test('the cache is per user, and an unreadable one reads as none', () => {
  writeCachedNotes('user-1', [{ id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' }]);

  expect(readCachedNotes('user-1')).toEqual([{ id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' }]);
  expect(readCachedNotes('user-2')).toBeNull();
  expect(kvGet('memory.user-1')).not.toBeNull();

  kvSet('memory.user-3', '[{"id":1}]');
  expect(readCachedNotes('user-3')).toBeNull();
});
