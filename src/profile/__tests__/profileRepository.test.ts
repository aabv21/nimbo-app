jest.mock('../../lib/supabase', () => ({ supabase: {} }));

import type { Client } from '../../auth/emailAuth';
import { kvGet, kvRemove } from '../../lib/kv';
import { acceptTerms, fetchProfile, readCachedProfile, setAiConsent, updateProfile } from '../profileRepository';

const ROW = {
  user_id: 'u1',
  language: 'es',
  timezone: 'America/Bogota',
  theme: 'dim',
  reduce_motion: true,
  notify_start: '09:00:00',
  notify_end: '20:00:00',
  notify_daily_cap: 1,
  lock_screen_detail: false,
  adult_confirmed_at: '2026-11-01T10:00:00Z',
  boundary_accepted_at: '2026-11-01T10:00:00Z',
  ai_consent_answered_at: '2026-11-01T10:01:00Z',
  ai_enabled: true,
  onboarding_completed_at: null,
  // Columns the app does not read; they must not leak into the cached profile.
  condition: 'migraine',
  coarse_lat: 4.7,
  created_at: '2026-11-01T09:00:00Z',
};

const PROFILE = {
  language: 'es',
  timezone: 'America/Bogota',
  theme: 'dim',
  reduceMotion: true,
  notifyStart: '09:00:00',
  notifyEnd: '20:00:00',
  notifyDailyCap: 1,
  lockScreenDetail: false,
  adultConfirmedAt: '2026-11-01T10:00:00Z',
  boundaryAcceptedAt: '2026-11-01T10:00:00Z',
  aiConsentAnsweredAt: '2026-11-01T10:01:00Z',
  aiEnabled: true,
  onboardingCompletedAt: null,
};

type Outcome = { data: unknown; error: { code?: string; message: string } | null; status: number };
const OK: Outcome = { data: ROW, error: null, status: 200 };
const OFFLINE: Outcome = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };

/** A client whose profile queries all answer `outcome`; `rpcOutcome` answers the RPCs. */
function fakeClient(outcome: Outcome, rpcOutcome: Outcome = { data: null, error: null, status: 204 }) {
  const single = jest.fn(() => Promise.resolve(outcome));
  const select = jest.fn(() => ({ single }));
  const update = jest.fn<{ not: () => { select: typeof select } }, [unknown]>(() => ({ not: () => ({ select }) }));
  const from = jest.fn<{ select: typeof select; update: typeof update }, [string]>(() => ({ select, update }));
  const rpc = jest.fn<Promise<Outcome>, [string, unknown]>(() => Promise.resolve(rpcOutcome));
  return { from, rpc, update, client: { from, rpc } as unknown as Client };
}

beforeEach(() => {
  kvRemove('profile.u1');
  kvRemove('profile.u2');
});

test('fetchProfile maps the columns to the Profile fields and caches them under the user id', async () => {
  const { client } = fakeClient(OK);

  const result = await fetchProfile(client);

  expect(result).toEqual({ ok: true, value: PROFILE });
  expect(JSON.parse(kvGet('profile.u1') ?? 'null')).toEqual(PROFILE);
});

test('readCachedProfile returns what the last fetch stored, and null for another user', async () => {
  await fetchProfile(fakeClient(OK).client);

  await expect(readCachedProfile('u1')).resolves.toEqual(PROFILE);
  await expect(readCachedProfile('u2')).resolves.toBeNull();
});

test('a cached value of another shape reads as no profile', async () => {
  const { kvSet } = await import('../../lib/kv');
  kvSet('profile.u1', JSON.stringify({ theme: 'neon' }));

  await expect(readCachedProfile('u1')).resolves.toBeNull();
});

test('updateProfile sends only the given fields, in column names, and leaves the cache alone', async () => {
  const { client, update } = fakeClient({ data: { ...ROW, theme: 'day' }, error: null, status: 200 });

  const result = await updateProfile({ theme: 'dim' }, client);

  expect(update).toHaveBeenCalledWith({ theme: 'dim' });
  expect(result).toEqual({ ok: true, value: { ...PROFILE, theme: 'day' } });
  // A late answer to an older write must not overwrite what the app shows.
  expect(kvGet('profile.u1')).toBeNull();
});

test('the consent calls refetch the row without caching it', async () => {
  const { client } = fakeClient(OK);

  await expect(acceptTerms(client)).resolves.toEqual({ ok: true, value: PROFILE });
  await expect(setAiConsent(true, client)).resolves.toEqual({ ok: true, value: PROFILE });

  expect(kvGet('profile.u1')).toBeNull();
});

test('updateProfile maps every editable field to its column', async () => {
  const { client, update } = fakeClient(OK);

  await updateProfile(
    {
      language: null,
      timezone: 'UTC',
      theme: 'day',
      reduceMotion: false,
      notifyStart: '08:00',
      notifyEnd: '21:00',
      notifyDailyCap: 0,
      lockScreenDetail: true,
    },
    client,
  );

  expect(update).toHaveBeenCalledWith({
    language: null,
    timezone: 'UTC',
    theme: 'day',
    reduce_motion: false,
    notify_start: '08:00',
    notify_end: '21:00',
    notify_daily_cap: 0,
    lock_screen_detail: true,
  });
});

test('acceptTerms calls accept_terms with both boxes ticked, then refetches', async () => {
  const { client, rpc } = fakeClient(OK);

  const result = await acceptTerms(client);

  expect(rpc).toHaveBeenCalledWith('accept_terms', { p_adult: true, p_boundary: true });
  expect(result).toEqual({ ok: true, value: PROFILE });
});

test('setAiConsent calls set_ai_consent with the answer, then refetches', async () => {
  const { client, rpc } = fakeClient(OK);

  await setAiConsent(false, client);

  expect(rpc).toHaveBeenCalledWith('set_ai_consent', { p_enabled: false });
});

test('a failed RPC returns its error and does not refetch', async () => {
  const { client, from } = fakeClient(OK, { data: null, error: { code: 'P0001', message: 'nope' }, status: 400 });

  await expect(acceptTerms(client)).resolves.toEqual({ ok: false, kind: 'unknown' });
  expect(from).not.toHaveBeenCalled();
});

test('a network failure returns the network kind and leaves the cache untouched', async () => {
  await fetchProfile(fakeClient(OK).client);

  const result = await fetchProfile(fakeClient(OFFLINE).client);

  expect(result).toEqual({ ok: false, kind: 'network' });
  await expect(readCachedProfile('u1')).resolves.toEqual(PROFILE);
});

test('a thrown fetch TypeError is a network failure too', async () => {
  const client = {
    from: () => ({
      select: () => ({
        single: () => Promise.reject(new TypeError('Network request failed')),
      }),
    }),
  } as unknown as Client;

  await expect(fetchProfile(client)).resolves.toEqual({ ok: false, kind: 'network' });
});

test('a rejected value is the invalid kind', async () => {
  const { client } = fakeClient({ data: null, error: { code: '23514', message: 'check' }, status: 400 });

  await expect(updateProfile({ notifyDailyCap: 2 }, client)).resolves.toEqual({ ok: false, kind: 'invalid' });
});

test.each(['system', 'day', 'dark', 'dim'] as const)('the %s appearance preference reads back', async (theme) => {
  const { client } = fakeClient({ data: { ...ROW, theme }, error: null, status: 200 });

  await expect(fetchProfile(client)).resolves.toEqual({ ok: true, value: { ...PROFILE, theme } });
});

test('a row of an unexpected shape is an unknown failure, not a crash', async () => {
  const { client } = fakeClient({ data: { user_id: 'u1', theme: 'neon' }, error: null, status: 200 });

  await expect(fetchProfile(client)).resolves.toEqual({ ok: false, kind: 'unknown' });
});
