import type { Client } from '../auth/emailAuth';
import { kvGetJson, kvSet } from '../lib/kv';
import { toRequestErrorKind, toThrownErrorKind } from '../lib/requestResult';
import type { RequestResult } from '../lib/requestResult';
import { supabase } from '../lib/supabase';
import type { Locale } from '../i18n';
import type { Tables, TablesUpdate } from '../lib/database.types';

export type ThemeName = 'day' | 'dim';

export interface Profile {
  language: Locale | null;
  timezone: string | null;
  theme: ThemeName;
  reduceMotion: boolean;
  notifyStart: string;
  notifyEnd: string;
  notifyDailyCap: 0 | 1 | 2;
  lockScreenDetail: boolean;
  adultConfirmedAt: string | null;
  boundaryAcceptedAt: string | null;
  aiConsentAnsweredAt: string | null;
  aiEnabled: boolean;
  onboardingCompletedAt: string | null;
}

export type EditableProfile = Pick<
  Profile,
  'language' | 'timezone' | 'theme' | 'reduceMotion' | 'notifyStart' | 'notifyEnd' | 'notifyDailyCap' | 'lockScreenDetail'
>;

type Row = Tables<'profiles'>;

// Row-level security scopes every query below to the signed-in user's own row, so none filters by id.
// The one exception to "no filter" is that the API rejects an UPDATE with no WHERE clause, so
// `updateProfile` adds a condition every row meets.

function cacheKey(userId: string): string {
  return `profile.${userId}`;
}

function isOneOf<T extends string | number>(value: unknown, allowed: readonly T[]): value is T {
  return allowed.some((candidate) => candidate === value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v['language'] === null || isOneOf(v['language'], ['en', 'es', 'pt'])) &&
    isNullableString(v['timezone']) &&
    isOneOf(v['theme'], ['day', 'dim']) &&
    typeof v['reduceMotion'] === 'boolean' &&
    typeof v['notifyStart'] === 'string' &&
    typeof v['notifyEnd'] === 'string' &&
    isOneOf(v['notifyDailyCap'], [0, 1, 2]) &&
    typeof v['lockScreenDetail'] === 'boolean' &&
    isNullableString(v['adultConfirmedAt']) &&
    isNullableString(v['boundaryAcceptedAt']) &&
    isNullableString(v['aiConsentAnsweredAt']) &&
    typeof v['aiEnabled'] === 'boolean' &&
    isNullableString(v['onboardingCompletedAt'])
  );
}

/** The row's app-facing fields; null when the row is not shaped like a profile. */
function toProfile(row: Row): Profile | null {
  const profile = {
    language: row.language,
    timezone: row.timezone,
    theme: row.theme,
    reduceMotion: row.reduce_motion,
    notifyStart: row.notify_start,
    notifyEnd: row.notify_end,
    notifyDailyCap: row.notify_daily_cap,
    lockScreenDetail: row.lock_screen_detail,
    adultConfirmedAt: row.adult_confirmed_at,
    boundaryAcceptedAt: row.boundary_accepted_at,
    aiConsentAnsweredAt: row.ai_consent_answered_at,
    aiEnabled: row.ai_enabled,
    onboardingCompletedAt: row.onboarding_completed_at,
  };
  return isProfile(profile) ? profile : null;
}

/** The cached profile of `userId`, read synchronously so a first render can use it. */
export function readCachedProfileSync(userId: string): Profile | null {
  return kvGetJson(cacheKey(userId), isProfile);
}

/** What the last successful fetch stored for `userId`; never another user's. */
export function readCachedProfile(userId: string): Promise<Profile | null> {
  return Promise.resolve(readCachedProfileSync(userId));
}

type Outcome = { data: Row | null; error: { code?: string; message?: string } | null; status: number };

/** Turns a single-row answer into a result, caching the profile under the row's own user id. */
function settle({ data, error, status }: Outcome): RequestResult<Profile> {
  if (error !== null) {
    return { ok: false, kind: toRequestErrorKind(error, status) };
  }
  const profile = data === null ? null : toProfile(data);
  if (data === null || profile === null) {
    return { ok: false, kind: 'unknown' };
  }
  kvSet(cacheKey(data.user_id), JSON.stringify(profile));
  return { ok: true, value: profile };
}

export async function fetchProfile(client: Client = supabase): Promise<RequestResult<Profile>> {
  try {
    return settle(await client.from('profiles').select('*').single());
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }
}

/** Column names for the fields a client may change (the column grants in `docs/database.md`). */
function toColumns(changes: Partial<EditableProfile>): TablesUpdate<'profiles'> {
  const columns: TablesUpdate<'profiles'> = {};
  if (changes.language !== undefined) columns.language = changes.language;
  if (changes.timezone !== undefined) columns.timezone = changes.timezone;
  if (changes.theme !== undefined) columns.theme = changes.theme;
  if (changes.reduceMotion !== undefined) columns.reduce_motion = changes.reduceMotion;
  if (changes.notifyStart !== undefined) columns.notify_start = changes.notifyStart;
  if (changes.notifyEnd !== undefined) columns.notify_end = changes.notifyEnd;
  if (changes.notifyDailyCap !== undefined) columns.notify_daily_cap = changes.notifyDailyCap;
  if (changes.lockScreenDetail !== undefined) columns.lock_screen_detail = changes.lockScreenDetail;
  return columns;
}

export async function updateProfile(
  changes: Partial<EditableProfile>,
  client: Client = supabase,
): Promise<RequestResult<Profile>> {
  try {
    return settle(await client.from('profiles').update(toColumns(changes)).not('user_id', 'is', null).select('*').single());
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }
}

/** Runs a consent RPC, then refetches so the caller gets the stamped timestamps. */
async function callThenFetch(
  client: Client,
  call: () => PromiseLike<{ error: { code?: string; message?: string } | null; status: number }>,
): Promise<RequestResult<Profile>> {
  try {
    const { error, status } = await call();
    if (error !== null) {
      return { ok: false, kind: toRequestErrorKind(error, status) };
    }
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }
  return fetchProfile(client);
}

/** The consent timestamps are set only by this function (never by a client write). */
export function acceptTerms(client: Client = supabase): Promise<RequestResult<Profile>> {
  return callThenFetch(client, () => client.rpc('accept_terms', { p_adult: true, p_boundary: true }));
}

export function setAiConsent(enabled: boolean, client: Client = supabase): Promise<RequestResult<Profile>> {
  return callThenFetch(client, () => client.rpc('set_ai_consent', { p_enabled: enabled }));
}
