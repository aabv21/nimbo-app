import { act, renderHook } from '@testing-library/react-native';

import { kvRemove } from '../../lib/kv';
import { localDb, purgeUser } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { showUrgentCare } from '../../redflags/urgentCare';
import { clearLocalDb } from '../../test/localDbTest';
import { applyDraft } from '../applyDraft';
import { appendMessage } from '../chatStore';
import type { ChatMessage } from '../chatStore';
import { askCompanion } from '../companionClient';
import type { CompanionOutcome } from '../companionClient';
import type { CompanionResponse, Draft, EpisodeDraft } from '../contract';
import { overQuotaToday, useCompanion } from '../useCompanion';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
const mockNetwork: { listeners: Set<(event: { isConnected: boolean; isInternetReachable: boolean }) => void>; emit: (online: boolean) => void } = {
  listeners: new Set(),
  emit: (online) => {
    for (const listener of mockNetwork.listeners) listener({ isConnected: online, isInternetReachable: online });
  },
};
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: (listener: (event: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
    mockNetwork.listeners.add(listener);
    return { remove: () => mockNetwork.listeners.delete(listener) };
  },
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../redflags/urgentCare', () => ({ showUrgentCare: jest.fn() }));
jest.mock('../companionClient', () => ({
  ...jest.requireActual<typeof import('../companionClient')>('../companionClient'),
  askCompanion: jest.fn(),
}));
jest.mock('../applyDraft', () => {
  const actual = jest.requireActual<typeof import('../applyDraft')>('../applyDraft');
  return { applyDraft: jest.fn(actual.applyDraft) };
});

const mockedAsk = jest.mocked(askCompanion);
const USER = 'user-1';
// Near midnight in Bogotá (UTC-5) the UTC date is already tomorrow; the request must carry the local day.
// 23:30 on the 27th in Bogotá; 04:30 on the 28th in UTC.
const NOW = new Date('2026-11-28T04:30:00Z');
const MED = '00000000-0000-4000-8000-0000000000a1';

const OK: CompanionResponse = { reply: 'Noted.', drafts: [], evidence: [], redFlags: [], intent: 'other', guard: 'ok', replaced: null };

const DRAFT: EpisodeDraft = {
  kind: 'episode',
  ref: 'd1',
  episodeId: null,
  startedAt: '2026-11-27T20:00:00.000Z',
  endedAt: '2026-11-27T23:00:00.000Z',
  intensity: 7,
  painAreas: [],
  symptoms: [],
  triggers: [],
  reliefs: [],
  helped: [],
  didNotHelp: [],
  doses: [{ medicationId: MED, takenAt: '2026-11-27T21:00:00.000Z' }],
};

/** The next request waits until the returned function answers it. */
function pendingAnswer(): (outcome: CompanionOutcome) => void {
  let resolve: (outcome: CompanionOutcome) => void = () => undefined;
  mockedAsk.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  return (outcome) => {
    resolve(outcome);
  };
}

function answer(outcome: CompanionOutcome): void {
  mockedAsk.mockResolvedValueOnce(outcome);
}

function seedDraft(draft: Draft, input: 'text' | 'voice' = 'text'): number {
  return appendMessage(USER, {
    role: 'assistant',
    input,
    text: 'I put it together like this.',
    template: null,
    createdAt: NOW.getTime(),
    status: 'answered',
    mode: 'chat',
    payload: { drafts: [draft], evidence: [], guard: 'ok', replaced: null, confirmed: {} },
  });
}

function stored(id: number): ChatMessage['payload'] {
  const row = localDb().getFirstSync<{ payload: string | null }>('SELECT payload FROM chat_messages WHERE id = ?;', [id]);
  return row?.payload == null ? null : (JSON.parse(row.payload) as ChatMessage['payload']);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock<typeof import('../../test/authMock')>('../../auth/AuthProvider').resetAuth();
  // Before the fake timers, which wrap `Intl` and would hide the spy.
  deviceZone('America/Bogota');
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  clearLocalDb();
  for (const kind of ['companion', 'dictation']) kvRemove(`companion.quota.${kind}.${USER}.2026-11-27`);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function deviceZone(timeZone: string): void {
  const real = new Intl.DateTimeFormat().resolvedOptions();
  jest.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ ...real, timeZone });
}

describe('confirm', () => {
  test('a second confirm, and a confirm after a remount, write nothing more', async () => {
    const id = seedDraft(DRAFT);
    const first = await renderHook(() => useCompanion('chat'));
    let results: string[] = [];
    await act(() => {
      results = [first.result.current.confirm(id, 'd1'), first.result.current.confirm(id, 'd1')];
    });
    expect(results).toEqual(['ok', 'ok']);
    expect(applyDraft).toHaveBeenCalledTimes(1);
    expect(listOutbox(USER).map((op) => op.kind)).toEqual(['log_episode', 'log_dose']);
    const recordId = stored(id)?.confirmed.d1;
    expect(recordId).toMatch(/^[0-9a-f-]{36}$/);
    expect(listOutbox(USER)[0]?.args).toMatchObject({ p_id: recordId });
    await first.unmount();

    const second = await renderHook(() => useCompanion('chat'));
    await act(() => {
      expect(second.result.current.confirm(id, 'd1')).toBe('ok');
    });
    expect(applyDraft).toHaveBeenCalledTimes(1);
    expect(listOutbox(USER)).toHaveLength(2);
  });

  test('a draft that ends before it starts is invalid: nothing is stamped and nothing is queued', async () => {
    const id = seedDraft({ ...DRAFT, endedAt: '2026-11-27T19:00:00.000Z' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(() => {
      expect(hook.result.current.confirm(id, 'd1')).toBe('invalid');
    });
    expect(stored(id)?.confirmed).toEqual({});
    expect(listOutbox(USER)).toEqual([]);
  });

  test('a dose draft whose attack was deleted since is invalid: nothing is stamped and no refused dose is queued', async () => {
    const id = seedDraft({ kind: 'dose', ref: 'd1', medicationId: MED, takenAt: '2026-11-27T21:00:00.000Z', episodeId: '00000000-0000-4000-8000-0000000000e7' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(() => {
      expect(hook.result.current.confirm(id, 'd1')).toBe('invalid');
    });
    expect(stored(id)?.confirmed).toEqual({});
    expect(listOutbox(USER)).toEqual([]);
  });

  test('a draft from a typed message is saved with the chat source, one from a dictated message with the voice source', async () => {
    const typed = seedDraft(DRAFT);
    const spoken = seedDraft({ ...DRAFT, ref: 'd2' }, 'voice');
    const hook = await renderHook(() => useCompanion('chat'));
    await act(() => {
      hook.result.current.confirm(typed, 'd1');
      hook.result.current.confirm(spoken, 'd2');
    });
    expect(applyDraft).toHaveBeenNthCalledWith(1, USER, expect.objectContaining({ ref: 'd1' }), expect.anything(), 'chat');
    expect(applyDraft).toHaveBeenNthCalledWith(2, USER, expect.objectContaining({ ref: 'd2' }), expect.anything(), 'voice');
    expect(localDb().getAllSync("SELECT source FROM episodes ORDER BY source;")).toEqual([{ source: 'chat' }, { source: 'voice' }]);
  });

  test('an unknown ref or message is a no-op', async () => {
    const id = seedDraft(DRAFT);
    const hook = await renderHook(() => useCompanion('chat'));
    await act(() => {
      expect(hook.result.current.confirm(id, 'd9')).toBe('ok');
      expect(hook.result.current.confirm(id + 100, 'd1')).toBe('ok');
    });
    expect(applyDraft).not.toHaveBeenCalled();
  });
});

describe('send', () => {
  test('a red flag on the phone opens urgent care and never asks the companion', async () => {
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('This is the worst headache of my life', 'text');
    });
    expect(showUrgentCare).toHaveBeenCalledWith(expect.objectContaining({ flags: ['thunderclap'], source: 'text', episodeId: null }));
    expect(mockedAsk).not.toHaveBeenCalled();
    expect(hook.result.current.messages.map((message) => [message.role, message.status])).toEqual([['user', 'red_flag']]);
  });

  test('a server red flag opens urgent care with the text source, then appends the after line', async () => {
    answer({ ok: true, result: { ...OK, reply: null, redFlags: ['weakness'] } });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('My arm feels odd', 'text');
    });
    expect(showUrgentCare).toHaveBeenCalledWith({ flags: ['weakness'], excerpt: 'My arm feels odd', source: 'text', episodeId: null });
    const [user, after] = hook.result.current.messages;
    expect(user?.status).toBe('red_flag');
    expect(after).toMatchObject({ role: 'assistant', status: 'red_flag', template: 'redflag_after', text: '' });
  });

  test('a red-flag body this version could not check still opens urgent care and appends the after line', async () => {
    // A newer server's flag key: no known key survives, and the screen still opens (it always offers the call).
    answer({ ok: true, unchecked: true, result: { ...OK, reply: null, redFlags: [] } });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('My arm feels odd', 'text');
    });
    expect(showUrgentCare).toHaveBeenCalledWith({ flags: [], excerpt: 'My arm feels odd', source: 'text', episodeId: null });
    expect(hook.result.current.messages.map((message) => [message.role, message.status, message.template])).toEqual([
      ['user', 'red_flag', null],
      ['assistant', 'red_flag', 'redflag_after'],
    ]);
  });

  test('sends the local day and the UI locale, and stores the reply with its payload', async () => {
    answer({ ok: true, result: { ...OK, drafts: [DRAFT] } });
    const hook = await renderHook(() => useCompanion('chat', { episodeId: '00000000-0000-4000-8000-0000000000e9' }));
    await act(async () => {
      await hook.result.current.send('  I had an attack  ', 'text');
    });
    expect(mockedAsk).toHaveBeenCalledWith({
      mode: 'chat',
      locale: 'en',
      localDate: '2026-11-27',
      input: 'text',
      messages: [{ role: 'user', text: 'I had an attack' }],
      episodeId: '00000000-0000-4000-8000-0000000000e9',
    });
    const [user, reply] = hook.result.current.messages;
    expect(user?.status).toBe('answered');
    expect(reply).toMatchObject({ role: 'assistant', text: 'Noted.', status: 'answered', payload: { drafts: [DRAFT], guard: 'ok', confirmed: {} } });
  });

  test('a replaced reply is stored with an empty text, and both turns leave the history', async () => {
    answer({ ok: true, result: { ...OK, reply: null, guard: 'replaced', replaced: 'dose_advice' } });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Can I take another?', 'text');
    });
    expect(hook.result.current.messages.map((message) => [message.role, message.status, message.text])).toEqual([
      ['user', 'replaced', 'Can I take another?'],
      ['assistant', 'replaced', ''],
    ]);
    expect(hook.result.current.messages[1]?.payload?.replaced).toBe('dose_advice');
  });

  test('a 429 on the companion quota stores its limit for that local day only', async () => {
    answer({ ok: false, error: 'over_quota', quota: 'companion', limit: 40 });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Hello', 'text');
    });
    expect(overQuotaToday(USER, '2026-11-27', 'companion')).toBe(40);
    expect(overQuotaToday(USER, '2026-11-28', 'companion')).toBeNull();
    expect(overQuotaToday(USER, '2026-11-27', 'dictation')).toBeNull();
    expect(hook.result.current.state).toBe('over_quota');
  });

  test('a 429 on dictation turns the mic off, keeps the chat ready and leaves the message to retry as text', async () => {
    answer({ ok: false, error: 'over_quota', quota: 'dictation', limit: 20 });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Spoken words', 'voice');
    });
    expect(hook.result.current.dictationOver).toBe(true);
    expect(hook.result.current.state).toBe('ready');
    const [user] = hook.result.current.messages;
    expect(user?.status).toBe('unsent');

    answer({ ok: true, result: OK });
    await act(async () => {
      await hook.result.current.retry(user?.id ?? -1);
    });
    expect(mockedAsk).toHaveBeenLastCalledWith(expect.objectContaining({ input: 'text', messages: [{ role: 'user', text: 'Spoken words' }] }));
    expect(hook.result.current.messages.map((message) => message.status)).toEqual(['answered', 'answered']);
  });

  test('a network failure leaves the message unsent; unavailable also shows the down state', async () => {
    answer({ ok: false, error: 'network' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Hello', 'text');
    });
    expect(hook.result.current.messages[0]?.status).toBe('unsent');
    expect(hook.result.current.state).toBe('ready');

    answer({ ok: false, error: 'unavailable' });
    await act(async () => {
      await hook.result.current.send('Again', 'text');
    });
    expect(hook.result.current.state).toBe('unavailable');
  });

  test('a message sent while another is in flight is kept as unsent, never dropped', async () => {
    const resolve = pendingAnswer();
    const hook = await renderHook(() => useCompanion('chat'));
    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = hook.result.current.send('One', 'text');
      await hook.result.current.send('Two', 'text');
    });
    expect(hook.result.current.typing).toBe(true);
    await act(async () => {
      resolve({ ok: true, result: OK });
      await first;
    });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messages.map((message) => [message.text, message.status])).toEqual([
      ['One', 'answered'],
      ['Two', 'unsent'],
      ['Noted.', 'answered'],
    ]);
    expect(hook.result.current.typing).toBe(false);
  });

  test('a red flag sent while another request is in flight still opens urgent care', async () => {
    const resolve = pendingAnswer();
    const hook = await renderHook(() => useCompanion('chat'));
    let first: Promise<unknown> = Promise.resolve();
    await act(async () => {
      first = hook.result.current.send('One', 'text');
      await hook.result.current.send('This is the worst headache of my life', 'text');
    });
    expect(showUrgentCare).toHaveBeenCalledWith(expect.objectContaining({ flags: ['thunderclap'], source: 'text' }));
    await act(async () => {
      resolve({ ok: true, result: OK });
      await first;
    });
    expect(hook.result.current.messages.find((message) => message.text.startsWith('This is'))?.status).toBe('red_flag');
  });

  test('over the quota, a new message is kept as unsent and Retry asks nothing', async () => {
    answer({ ok: false, error: 'over_quota', quota: 'companion', limit: 40 });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Hello', 'text');
      await hook.result.current.send('Still there?', 'text');
    });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
    expect(hook.result.current.messages.map((message) => [message.text, message.status])).toEqual([
      ['Hello', 'unsent'],
      ['Still there?', 'unsent'],
    ]);
    await act(async () => {
      await hook.result.current.retry(hook.result.current.messages[0]?.id ?? -1);
    });
    expect(mockedAsk).toHaveBeenCalledTimes(1);
  });

  test('Retry keeps a dictated message as voice', async () => {
    answer({ ok: false, error: 'network' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Spoken words', 'voice');
    });
    answer({ ok: true, result: OK });
    await act(async () => {
      await hook.result.current.retry(hook.result.current.messages[0]?.id ?? -1);
    });
    expect(mockedAsk).toHaveBeenLastCalledWith(expect.objectContaining({ input: 'voice' }));
  });

  test('a dictated message keeps its input after a restart: Retry sends it as voice and its answer is stored as voice', async () => {
    // Written before the app died: nothing of it is left in memory.
    const id = appendMessage(USER, { role: 'user', input: 'voice', text: 'Spoken words', template: null, createdAt: NOW.getTime(), status: 'unsent', mode: 'chat', payload: null });
    const hook = await renderHook(() => useCompanion('chat'));
    answer({ ok: true, result: { ...OK, drafts: [DRAFT] } });
    await act(async () => {
      await hook.result.current.retry(id);
    });
    expect(mockedAsk).toHaveBeenLastCalledWith(expect.objectContaining({ input: 'voice' }));
    const reply = hook.result.current.messages.at(-1);
    expect(reply).toEqual(expect.objectContaining({ role: 'assistant', input: 'voice' }));
    await act(() => {
      hook.result.current.confirm(reply?.id ?? -1, 'd1');
    });
    expect(applyDraft).toHaveBeenLastCalledWith(USER, expect.objectContaining({ ref: 'd1' }), expect.anything(), 'voice');
  });

  test('send stores the input on the message and returns its id; a red flag returns null', async () => {
    answer({ ok: true, result: OK });
    const hook = await renderHook(() => useCompanion('chat'));
    let sent: number | null = null;
    let flagged: number | null = -1;
    await act(async () => {
      sent = await hook.result.current.send('Spoken words', 'voice');
      flagged = await hook.result.current.send('This is the worst headache of my life', 'voice');
    });
    expect(hook.result.current.messages.find((message) => message.id === sent)).toEqual(expect.objectContaining({ text: 'Spoken words', input: 'voice' }));
    expect(flagged).toBeNull();
  });

  test('a server red flag that arrives after the account changed opens nothing and stores nothing', async () => {
    const { setAuth } = jest.requireMock<typeof import('../../test/authMock')>('../../auth/AuthProvider');
    const resolve = pendingAnswer();
    const hook = await renderHook(() => useCompanion('chat'));
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = hook.result.current.send('My arm feels odd', 'text');
      await Promise.resolve();
    });
    await act(() => {
      setAuth({ userId: 'user-2' });
    });
    await act(async () => {
      resolve({ ok: true, result: { ...OK, reply: null, redFlags: ['weakness'] } });
      await pending;
    });
    expect(showUrgentCare).not.toHaveBeenCalled();
    expect(localDb().getFirstSync<{ n: number }>("SELECT COUNT(*) AS n FROM chat_messages WHERE role = 'assistant';")?.n).toBe(0);
  });

  test('the down state clears when the network comes back', async () => {
    answer({ ok: false, error: 'unavailable' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Hello', 'text');
    });
    expect(hook.result.current.state).toBe('unavailable');
    await act(() => {
      mockNetwork.emit(false);
      mockNetwork.emit(true);
    });
    expect(hook.result.current.state).toBe('ready');
  });

  test('an answer that arrives after a sign-out purged the chat stores nothing', async () => {
    let resolve: (outcome: CompanionOutcome) => void = () => undefined;
    mockedAsk.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const hook = await renderHook(() => useCompanion('chat'));
    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = hook.result.current.send('Hello', 'text');
      await Promise.resolve();
    });
    purgeUser(USER);
    await act(async () => {
      resolve({ ok: true, result: { ...OK, reply: null, redFlags: ['weakness'] } });
      await pending;
    });
    expect(localDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM chat_messages;')?.n).toBe(0);
    expect(showUrgentCare).not.toHaveBeenCalled();
  });

  test('ai_off refetches the profile', async () => {
    const { currentAuth } = jest.requireMock<typeof import('../../test/authMock')>('../../auth/AuthProvider');
    answer({ ok: false, error: 'ai_off' });
    const hook = await renderHook(() => useCompanion('chat'));
    await act(async () => {
      await hook.result.current.send('Hello', 'text');
    });
    expect(currentAuth().refreshProfile).toHaveBeenCalled();
    await flush();
  });
});
