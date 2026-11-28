jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

import { AI_CONSENT_VERSION, TERMS_VERSION } from '../../account/consent';
import type { Client } from '../../auth/emailAuth';
import { kvGet, kvRemove } from '../../lib/kv';
import { listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import type { Profile } from '../profileRepository';
import {
  acceptTerms,
  completeOnboarding,
  fetchProfile,
  PROFILE_COLUMNS,
  readCachedProfileSync,
  setAiConsent,
  updateProfile,
  writeCachedProfile,
} from '../profileRepository';

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
  known_triggers: ['weather'],
  priority: 'overuse',
  track_period: true,
  terms_version: '2026-12-01',
  ai_consent_version: null,
  // Columns the app does not read; they must not leak into the cached profile.
  condition: 'migraine',
  created_at: '2026-11-01T09:00:00Z',
};

const PROFILE: Profile = {
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
  knownTriggers: ['weather'],
  priority: 'overuse',
  trackPeriod: true,
  termsVersion: '2026-12-01',
  aiConsentVersion: null,
};

type Outcome = { data: unknown; error: { code?: string; message: string } | null; status: number };
const OK: Outcome = { data: ROW, error: null, status: 200 };
const OFFLINE: Outcome = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };

/** A client whose profile queries all answer `outcome`; `rpcOutcome` answers the RPCs. */
function fakeClient(outcome: Outcome, rpcOutcome: Outcome = { data: null, error: null, status: 204 }) {
  const single = jest.fn(() => Promise.resolve(outcome));
  const select = jest.fn<{ single: typeof single }, [string]>(() => ({ single }));
  const update = jest.fn<{ not: () => { select: typeof select } }, [unknown]>(() => ({ not: () => ({ select }) }));
  const from = jest.fn<{ select: typeof select; update: typeof update }, [string]>(() => ({ select, update }));
  const rpc = jest.fn<Promise<Outcome>, [string, unknown]>(() => Promise.resolve(rpcOutcome));
  return { from, rpc, update, select, client: { from, rpc } as unknown as Client };
}

beforeEach(() => {
  kvRemove('profile.u1');
  kvRemove('profile.u2');
  clearLocalDb();
});

test('fetchProfile maps the columns to the Profile fields and never writes the cache', async () => {
  const { client } = fakeClient(OK);

  const result = await fetchProfile(client);

  expect(result).toEqual({ ok: true, value: PROFILE });
  expect(kvGet('profile.u1')).toBeNull();
});

test('readCachedProfileSync returns what writeCachedProfile stored, and null for another user', () => {
  writeCachedProfile('u1', PROFILE);

  expect(readCachedProfileSync('u1')).toEqual(PROFILE);
  expect(readCachedProfileSync('u2')).toBeNull();
});

test('a theme or language newer than this build reads as Automatic and the phone language', async () => {
  const { client } = fakeClient({ data: { ...ROW, theme: 'sepia', language: 'fr' }, error: null, status: 200 });

  await expect(fetchProfile(client)).resolves.toEqual({ ok: true, value: { ...PROFILE, theme: 'system', language: null } });
});

test('a cached value of another shape reads as no profile', async () => {
  const { kvSet } = await import('../../lib/kv');
  kvSet('profile.u1', JSON.stringify({ theme: 'neon' }));

  expect(readCachedProfileSync('u1')).toBeNull();
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

  await expect(acceptTerms('en', client)).resolves.toEqual({ ok: true, value: PROFILE });
  await expect(setAiConsent(true, 'en', client)).resolves.toEqual({ ok: true, value: PROFILE });

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
      knownTriggers: ['stress'],
      priority: 'fewer',
      trackPeriod: false,
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
    known_triggers: ['stress'],
    priority: 'fewer',
    track_period: false,
  });
});

test('acceptTerms calls accept_terms with every box ticked, this build\'s version and the locale, then refetches', async () => {
  const { client, rpc } = fakeClient(OK);

  const result = await acceptTerms('pt', client);

  expect(rpc).toHaveBeenCalledWith('accept_terms', {
    p_adult: true,
    p_boundary: true,
    p_health: true,
    p_version: TERMS_VERSION,
    p_locale: 'pt',
  });
  expect(result).toEqual({ ok: true, value: PROFILE });
});

test('setAiConsent calls set_ai_consent with the answer, this build\'s version and the locale, then refetches', async () => {
  const { client, rpc } = fakeClient(OK);

  await setAiConsent(false, 'es', client);

  expect(rpc).toHaveBeenCalledWith('set_ai_consent', { p_enabled: false, p_version: AI_CONSENT_VERSION, p_locale: 'es' });
});

test('a failed RPC returns its error and does not refetch', async () => {
  const { client, from } = fakeClient(OK, { data: null, error: { code: 'P0001', message: 'nope' }, status: 400 });

  await expect(acceptTerms('en', client)).resolves.toEqual({ ok: false, kind: 'unknown' });
  expect(from).not.toHaveBeenCalled();
});

test('a network failure returns the network kind and leaves the cache untouched', async () => {
  writeCachedProfile('u1', PROFILE);

  const result = await fetchProfile(fakeClient(OFFLINE).client);

  expect(result).toEqual({ ok: false, kind: 'network' });
  expect(readCachedProfileSync('u1')).toEqual(PROFILE);
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

test('fetchProfile selects the explicit column list, never the location or a star', async () => {
  const { client, select } = fakeClient(OK);

  await fetchProfile(client);

  expect(select).toHaveBeenCalledWith(PROFILE_COLUMNS);
  expect(PROFILE_COLUMNS).toContain('known_triggers,priority,track_period,terms_version,ai_consent_version');
  expect(PROFILE_COLUMNS).not.toContain('coarse_lat');
  expect(PROFILE_COLUMNS).not.toContain('coarse_lon');
  expect(PROFILE_COLUMNS).not.toContain('condition');
  expect(PROFILE_COLUMNS).not.toContain('*');
});

test('updateProfile writes the coarse location as two columns, and null clears both', async () => {
  const { client, update } = fakeClient(OK);

  await updateProfile({ coarseLocation: { lat: 4.7, lon: -74.1 } }, client);
  await updateProfile({ coarseLocation: null }, client);

  expect(update).toHaveBeenNthCalledWith(1, { coarse_lat: 4.7, coarse_lon: -74.1 });
  expect(update).toHaveBeenNthCalledWith(2, { coarse_lat: null, coarse_lon: null });
});

test('updateProfile sends known triggers as known_triggers', async () => {
  const { client, update } = fakeClient(OK);

  await updateProfile({ knownTriggers: ['weather'] }, client);

  expect(update).toHaveBeenCalledWith({ known_triggers: ['weather'] });
});

// The supabase client is an empty object here, so a request would throw: the finish is the outbox's to send.
test('completeOnboarding queues the RPC for the outbox and returns the local stamp, with no request', () => {
  const now = new Date('2026-11-27T10:00:00.000Z');

  expect(completeOnboarding('u1', now)).toBe('2026-11-27T10:00:00.000Z');
  expect(listOutbox('u1')).toEqual([expect.objectContaining({ kind: 'complete_onboarding', args: {} })]);
});

test('a priority this build does not know reads as null', async () => {
  const { client } = fakeClient({ data: { ...ROW, priority: 'doctor' }, error: null, status: 200 });

  await expect(fetchProfile(client)).resolves.toEqual({ ok: true, value: { ...PROFILE, priority: null } });
});

test('a profile cached by the previous build reads with the defaults, not as no profile', async () => {
  const { kvSet } = await import('../../lib/kv');
  const wave1: Record<string, unknown> = { ...PROFILE };
  delete wave1['knownTriggers'];
  delete wave1['priority'];
  delete wave1['trackPeriod'];
  kvSet('profile.u1', JSON.stringify(wave1));

  expect(readCachedProfileSync('u1')).toEqual({ ...wave1, knownTriggers: [], priority: null, trackPeriod: false });
});

test('a profile cached before consent versions existed reads with no version answered', async () => {
  const { kvSet } = await import('../../lib/kv');
  const unversioned: Record<string, unknown> = { ...PROFILE };
  delete unversioned['termsVersion'];
  delete unversioned['aiConsentVersion'];
  kvSet('profile.u1', JSON.stringify(unversioned));

  expect(readCachedProfileSync('u1')).toEqual({ ...PROFILE, termsVersion: null, aiConsentVersion: null });
});

test('a cached priority this build does not know reads as null', async () => {
  const { kvSet } = await import('../../lib/kv');
  kvSet('profile.u1', JSON.stringify({ ...PROFILE, priority: 'doctor' }));

  expect(readCachedProfileSync('u1')).toEqual({ ...PROFILE, priority: null });
});
