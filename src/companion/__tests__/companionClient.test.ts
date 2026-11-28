jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';

import type { ChatMessage, ChatStatus } from '../chatStore';
import { deviceTimeZone } from '../../lib/localDate';
import { askCompanion, historyForRequest } from '../companionClient';
import type { CompanionRequest, CompanionResponse } from '../contract';

type InvokeResult = { data: unknown; error: unknown };

function fakeClient(invoke: (name: string, options: unknown) => Promise<InvokeResult>) {
  return { functions: { invoke: jest.fn(invoke) } } as unknown as NonNullable<Parameters<typeof askCompanion>[1]>;
}

const REQUEST: CompanionRequest = { mode: 'chat', locale: 'en', localDate: '2026-11-27', input: 'text', messages: [{ role: 'user', text: 'Hi' }] };
const OK: CompanionResponse = { reply: 'Hello.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null };

let nextId = 0;
function message(role: ChatMessage['role'], text: string, status: ChatStatus = 'answered', patch: Partial<ChatMessage> = {}): ChatMessage {
  nextId += 1;
  return { id: nextId, role, input: 'text', text, template: null, createdAt: nextId, status, mode: 'chat', payload: null, ...patch };
}

describe('askCompanion', () => {
  test('sends the request with the device zone and answers a checked body', async () => {
    const invoke = jest.fn(() => Promise.resolve({ data: OK, error: null }));
    expect(await askCompanion(REQUEST, fakeClient(invoke))).toEqual({ ok: true, result: OK });
    expect(invoke).toHaveBeenCalledWith('companion', { body: { ...REQUEST, timeZone: deviceTimeZone() } });
  });

  test('a 429 is over_quota with the kind and limit its body names', async () => {
    const response = new Response(JSON.stringify({ error: 'over_quota', quota: 'dictation', limit: 20 }), { status: 429 });
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(response) }));
    expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error: 'over_quota', quota: 'dictation', limit: 20 });
  });

  test('a 429 whose body names no quota is unknown', async () => {
    const response = new Response('nope', { status: 429 });
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(response) }));
    expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error: 'unknown' });
  });

  test.each([
    [403, 'ai_off'],
    [503, 'unavailable'],
    [500, 'unavailable'],
    [502, 'unavailable'],
    [400, 'unknown'],
    [401, 'unknown'],
  ] as const)('a %i is %s', async (status, error) => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsHttpError(new Response(null, { status })) }));
    expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error });
  });

  test('a relay error (the gateway, not the function) is unavailable', async () => {
    const client = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsRelayError(new Response(null, { status: 502 })) }));
    expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error: 'unavailable' });
  });

  test('a failed fetch or a throw is network', async () => {
    const fetchFailed = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('offline')) }));
    expect(await askCompanion(REQUEST, fetchFailed)).toEqual({ ok: false, error: 'network' });
    const thrown = fakeClient(() => Promise.reject(new TypeError('Network request failed')));
    expect(await askCompanion(REQUEST, thrown)).toEqual({ ok: false, error: 'network' });
  });

  test('a body that fails isCompanionResponse is unknown', async () => {
    const client = fakeClient(() => Promise.resolve({ data: { ...OK, guard: 'replaced' }, error: null }));
    expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error: 'unknown' });
  });

  describe('red flags from a newer server still open urgent care', () => {
    const RED_ONLY = { reply: null, drafts: [], evidence: [], intent: 'other', guard: 'ok', replaced: null };

    test('known flags in a body that fails its other checks come back as a red-flag answer', async () => {
      const data = { ...RED_ONLY, redFlags: ['thunderclap'], drafts: [{ kind: 'reminder', ref: 'd1' }], intent: 'new_intent' };
      const client = fakeClient(() => Promise.resolve({ data, error: null }));
      expect(await askCompanion(REQUEST, client)).toEqual({ ok: true, unchecked: true, result: { ...RED_ONLY, redFlags: ['thunderclap'] } });
    });

    test('a flag key this version does not know still counts, with only the known keys kept', async () => {
      const client = fakeClient(() => Promise.resolve({ data: { ...RED_ONLY, redFlags: ['new_flag', 'weakness'] }, error: null }));
      expect(await askCompanion(REQUEST, client)).toEqual({ ok: true, unchecked: true, result: { ...RED_ONLY, redFlags: ['weakness'] } });
      const unknownOnly = fakeClient(() => Promise.resolve({ data: { ...RED_ONLY, redFlags: ['new_flag'] }, error: null }));
      expect(await askCompanion(REQUEST, unknownOnly)).toEqual({ ok: true, unchecked: true, result: { ...RED_ONLY, redFlags: [] } });
    });

    test.each([
      ['an empty list', []],
      ['a list with a non-string', ['thunderclap', 3]],
      ['no list', undefined],
    ])('%s is not a red flag: the body stays unknown', async (_label, redFlags) => {
      const client = fakeClient(() => Promise.resolve({ data: { ...RED_ONLY, redFlags, guard: 'nope' }, error: null }));
      expect(await askCompanion(REQUEST, client)).toEqual({ ok: false, error: 'unknown' });
    });
  });
});

describe('historyForRequest', () => {
  test('drops red_flag, unsent, replaced and template messages', () => {
    const chat = [
      message('user', 'flagged', 'red_flag'),
      message('assistant', '', 'red_flag', { template: 'redflag_after' }),
      message('user', 'lost', 'unsent'),
      message('user', 'dose?', 'replaced'),
      message('assistant', '', 'replaced'),
      message('assistant', '', 'answered', { template: 'debrief_done' }),
      message('user', 'kept question'),
      message('assistant', 'kept answer'),
      message('user', 'now', 'sent'),
    ];
    expect(historyForRequest(chat)).toEqual([
      { role: 'user', text: 'kept question' },
      { role: 'assistant', text: 'kept answer' },
      { role: 'user', text: 'now' },
    ]);
  });

  test('keeps the last 12 turns, starting with a user turn', () => {
    const chat = Array.from({ length: 15 }, (_, n) => message(n % 2 === 0 ? 'user' : 'assistant', `t${String(n)}`));
    const sent = historyForRequest(chat);
    expect(sent.length).toBeLessThanOrEqual(12);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)).toEqual({ role: 'user', text: 't14' });
  });

  test('drops the oldest turns until the total fits 4,000 characters', () => {
    const chat: ChatMessage[] = [];
    for (let n = 0; n < 5; n += 1) chat.push(message('user', 'a'.repeat(500)), message('assistant', 'b'.repeat(500)));
    chat.push(message('user', 'last', 'sent'));
    const sent = historyForRequest(chat);
    expect(sent.reduce((sum, turn) => sum + Array.from(turn.text).length, 0)).toBeLessThanOrEqual(4000);
    expect(sent[0]?.role).toBe('user');
    expect(sent.at(-1)?.text).toBe('last');
  });

  test('cuts a turn to 500 characters, so a long stored reply cannot make the request invalid', () => {
    const sent = historyForRequest([message('user', 'q'), message('assistant', 'x'.repeat(700)), message('user', 'next', 'sent')]);
    expect(Array.from(sent[1]?.text ?? '')).toHaveLength(500);
  });
});
