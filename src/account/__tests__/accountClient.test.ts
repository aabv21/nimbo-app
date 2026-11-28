import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
  FunctionsFetchError,
  FunctionsHttpError,
} from '@supabase/supabase-js';

import { deleteAccount, exportData, exportFileName, verifyAccount } from '../accountClient';

jest.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, auth: { getUser: jest.fn(), getSession: jest.fn() } },
}));

type InvokeResult = { data: unknown; error: unknown };
type GetUserResult = { data: { user: unknown }; error: unknown };
type GetSessionResult = { data: { session: { access_token: string; user: { id: string } } | null }; error: unknown };

const TOKEN = 'access-token-1';

function signedIn(): Promise<GetUserResult> {
  return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null });
}

function withSession(): Promise<GetSessionResult> {
  return Promise.resolve({ data: { session: { access_token: TOKEN, user: { id: 'user-1' } } }, error: null });
}

/** A fake client with only the `functions.invoke` and `auth` surface the account client uses. */
function fakeClient(
  invoke: () => Promise<InvokeResult>,
  getUser: () => Promise<GetUserResult> = signedIn,
  getSession: () => Promise<GetSessionResult> = withSession,
) {
  const client = { functions: { invoke: jest.fn(invoke) }, auth: { getUser: jest.fn(getUser), getSession: jest.fn(getSession) } };
  return { client: client as unknown as Parameters<typeof deleteAccount>[0], invoke: client.functions.invoke, getUser: client.auth.getUser };
}

function httpError(status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(null, { status }));
}

function unauthorized(): Promise<InvokeResult> {
  return Promise.resolve({ data: null, error: httpError(401) });
}

describe('deleteAccount', () => {
  test("the function's 200 `deleted` is a deletion, asked with the session's token", async () => {
    const { client, invoke, getUser } = fakeClient(() => Promise.resolve({ data: { outcome: 'deleted' }, error: null }));

    expect(await deleteAccount(client)).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith('delete-account', { body: {}, headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(getUser).not.toHaveBeenCalled();
  });

  test('a 200 with any other body is not taken as a deletion', async () => {
    const { client } = fakeClient(() => Promise.resolve({ data: { outcome: 'maybe' }, error: null }));

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'unknown' });
  });

  test('a 500 keeps the account', async () => {
    const { client, getUser } = fakeClient(() => Promise.resolve({ data: null, error: httpError(500) }));

    expect(await deleteAccount(client)).toEqual({ ok: false, error: 'unknown' });
    expect(getUser).not.toHaveBeenCalled();
  });

  test('a network failure, answered or thrown, is network', async () => {
    const answered = fakeClient(() => Promise.resolve({ data: null, error: new FunctionsFetchError(new TypeError('Network request failed')) }));
    const thrown = fakeClient(() => Promise.reject(new TypeError('Network request failed')));

    expect(await deleteAccount(answered.client)).toEqual({ ok: false, error: 'network' });
    expect(await deleteAccount(thrown.client)).toEqual({ ok: false, error: 'network' });
  });

  test('no session asks to sign in again without calling the function; an unreachable refresh is network', async () => {
    const none = fakeClient(unauthorized, signedIn, () => Promise.resolve({ data: { session: null }, error: new AuthSessionMissingError() }));
    const offline = fakeClient(unauthorized, signedIn, () =>
      Promise.resolve({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
    );

    expect(await deleteAccount(none.client)).toEqual({ ok: false, error: 'reauth' });
    expect(await deleteAccount(offline.client)).toEqual({ ok: false, error: 'network' });
    expect(none.invoke).not.toHaveBeenCalled();
    expect(offline.invoke).not.toHaveBeenCalled();
  });

  describe('a 401', () => {
    test('is reauth while Auth still knows the user', async () => {
      const { client } = fakeClient(unauthorized);

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'reauth' });
    });

    test('is a deletion when Auth answers user_not_found for the same token', async () => {
      const { client, getUser } = fakeClient(unauthorized, () =>
        Promise.resolve({ data: { user: null }, error: new AuthApiError('User from sub claim in JWT does not exist', 403, 'user_not_found') }),
      );

      expect(await deleteAccount(client)).toEqual({ ok: true });
      expect(getUser).toHaveBeenCalledWith(TOKEN);
    });

    const notGone: [string, Error][] = [
      ['an expired token', new AuthApiError('invalid JWT: token is expired', 403, 'bad_jwt')],
      ['a missing session', new AuthSessionMissingError()],
      ['any other Auth error', new AuthApiError('boom', 500, 'unexpected_failure')],
    ];
    test.each(notGone)('is reauth, never deleted, on %s', async (_label, error) => {
      const { client } = fakeClient(unauthorized, () => Promise.resolve({ data: { user: null }, error }));

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'reauth' });
    });

    test('is network when Auth cannot be reached', async () => {
      const { client } = fakeClient(unauthorized, () =>
        Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) }),
      );

      expect(await deleteAccount(client)).toEqual({ ok: false, error: 'network' });
    });
  });
});

describe('verifyAccount', () => {
  const noInvoke = (): Promise<InvokeResult> => Promise.reject(new Error('verifyAccount must never call a function'));

  test('is gone on user_not_found, exists for this same user, and calls no function', async () => {
    const gone = fakeClient(noInvoke, () => Promise.resolve({ data: { user: null }, error: new AuthApiError('gone', 403, 'user_not_found') }));
    const exists = fakeClient(noInvoke);

    expect(await verifyAccount('user-1', gone.client)).toBe('gone');
    expect(await verifyAccount('user-1', exists.client)).toBe('exists');
    expect(gone.invoke).not.toHaveBeenCalled();
  });

  test.each([
    ['Auth returns another user', () => Promise.resolve({ data: { user: { id: 'user-2' } }, error: null })],
    ['Auth cannot be reached', () => Promise.resolve({ data: { user: null }, error: new AuthRetryableFetchError('x', 0) })],
    ['the token expired', () => Promise.resolve({ data: { user: null }, error: new AuthApiError('expired', 403, 'bad_jwt') })],
  ] satisfies [string, () => Promise<GetUserResult>][])('is unknown when %s', async (_label, getUser) => {
    const { client } = fakeClient(noInvoke, getUser);

    expect(await verifyAccount('user-1', client)).toBe('unknown');
  });

  test("is unknown without a session, or with another user's", async () => {
    const none = fakeClient(noInvoke, signedIn, () => Promise.resolve({ data: { session: null }, error: null }));
    const other = fakeClient(noInvoke, signedIn, () =>
      Promise.resolve({ data: { session: { access_token: TOKEN, user: { id: 'user-2' } } }, error: null }),
    );

    expect(await verifyAccount('user-1', none.client)).toBe('unknown');
    expect(await verifyAccount('user-1', other.client)).toBe('unknown');
    expect(none.getUser).not.toHaveBeenCalled();
  });
});

describe('exportData', () => {
  const EXPORT = { schemaVersion: 1, exportedAt: '2026-12-01T12:00:00.000Z', profile: { user_id: 'user-1' }, episodes: [] };

  test("returns the function's document as indented JSON", async () => {
    const { client, invoke } = fakeClient(() => Promise.resolve({ data: EXPORT, error: null }));

    expect(await exportData(client)).toEqual({ ok: true, json: JSON.stringify(EXPORT, null, 2) });
    expect(invoke).toHaveBeenCalledWith('export-data', { body: {} });
  });

  test.each([
    ['an HTTP error', { data: null, error: httpError(500) }, 'unknown'],
    ['a 401 (the session refused)', { data: null, error: httpError(401) }, 'reauth'],
    ['a network error', { data: null, error: new FunctionsFetchError(new TypeError('x')) }, 'network'],
    ['an empty body', { data: null, error: null }, 'unknown'],
    ['a body without schemaVersion 1', { data: { ...EXPORT, schemaVersion: 2 }, error: null }, 'unknown'],
    ['a body with no schemaVersion', { data: { exportedAt: EXPORT.exportedAt }, error: null }, 'unknown'],
    ['a list', { data: [EXPORT], error: null }, 'unknown'],
  ] as const)('%s is a failure, never a file', async (_label, answer, expected) => {
    const { client } = fakeClient(() => Promise.resolve(answer));

    expect(await exportData(client)).toEqual({ ok: false, error: expected });
  });
});

test("exportFileName names the file after the device's local day", () => {
  expect(exportFileName(new Date(2026, 11, 1, 23, 30))).toBe('nimbo-data-2026-12-01.json');
});
