// Everything the server keeps about the caller as one JSON document (docs/api.md#export-data). Reads with the caller's
// token (RLS applies), except usage_counters, which no client may read. Logs carry only an outcome word.

import type { SupabaseEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { bodyProblemReply, callerOf, fetchWithDeadline, readBodyCapped, reply } from '../_shared/http.ts';
import { POSTGREST_TIMEOUT_MS, RefusedSession, restJson, serviceHeaders, sessionRefused, UpstreamError, userHeaders } from '../_shared/rest.ts';

export type ExportDataDeps = { env: SupabaseEnv; fetch: typeof fetch; now?: () => number };

/** PostgREST's `max_rows` (1000 here); paging by rows received still reads all under a smaller hosted cap. */
export const PAGE = 1000;
/** The phone sends no body; anything past this is refused unread. */
export const MAX_BODY_BYTES = 256;
/** The file holds health data: no cache on the way may keep a copy. */
export const NO_STORE = { 'cache-control': 'no-store' } as const;

/** With EXCLUDED_TABLES, every `public` table with a `user_id`: the unit test checks they equal account.test.sql's pinned list. */
export const EXPORTED_TABLES = [
  'profiles',
  'episodes',
  'medications',
  'doses',
  'checkins',
  'agent_notes',
  'entitlements',
  'usage_counters',
  'signals',
  'push_tokens',
  'consent_events',
] as const;
/** Transient security and delivery data (an hour, or two days): not the user's records. */
export const EXCLUDED_TABLES = ['push_claims', 'push_claim_starts', 'push_tickets'] as const;

type Table = (typeof EXPORTED_TABLES)[number];
type Row = Record<string, unknown>;

export interface DataExport {
  schemaVersion: 1;
  exportedAt: string;
  termsVersion: string | null;
  aiConsentVersion: string | null;
  account: { email: string | null; createdAt: string | null; lastSignInAt: string | null; providers: string[] };
  profile: Row | null;
  episodes: Row[];
  medications: Row[];
  doses: Row[];
  checkins: Row[];
  agentNotes: Row[];
  signals: Row[];
  entitlement: Row | null;
  usageCounters: Row[];
  consentEvents: Row[];
  /** Each registered phone without its push token or device secret hash, which are delivery credentials. */
  pushDevices: Row[];
}

// The select string never names `token` or `device_secret_hash`, so neither leaves the database.
const PUSH_DEVICE_COLUMNS = 'user_id,platform,updated_at';

/** Each table's columns and stable order; `usage_counters` is the one read with the service role. */
const READS = new Map<Table, { select: string; order: string; service?: true }>([
  ['profiles', { select: '*', order: 'user_id' }],
  ['episodes', { select: '*', order: 'started_at,id' }],
  ['medications', { select: '*', order: 'created_at,id' }],
  ['doses', { select: '*', order: 'taken_at,id' }],
  ['checkins', { select: '*', order: 'local_date' }],
  ['agent_notes', { select: '*', order: 'created_at,id' }],
  ['entitlements', { select: '*', order: 'user_id' }],
  ['usage_counters', { select: '*', order: 'day,kind', service: true }],
  ['signals', { select: '*', order: 'computed_at,id' }],
  // `token` only orders (unique per user), so paging is stable; it is never selected.
  ['push_tokens', { select: PUSH_DEVICE_COLUMNS, order: 'updated_at,platform,token' }],
  ['consent_events', { select: '*', order: 'created_at,id' }],
]);

type Context = { env: SupabaseEnv; fetchFn: typeof fetch; auth: string; userId: string };

/** Every row of `table` with `user_id = caller`, in a stable order, page by page until an empty page. */
async function readAll(context: Context, table: Table): Promise<Row[]> {
  const { env, fetchFn, auth, userId } = context;
  const read = READS.get(table);
  if (read === undefined) throw new UpstreamError(`${table}: no read`);
  const { select, order, service } = read;
  const headers = service === true ? serviceHeaders(env) : userHeaders(env, auth);
  const base = `${env.supabaseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}&user_id=eq.${userId}&order=${order}`;
  const rows: Row[] = [];
  for (let offset = 0; ; ) {
    const page = await restJson(fetchFn, `${base}&limit=${String(PAGE)}&offset=${String(offset)}`, { headers });
    if (!Array.isArray(page)) throw new UpstreamError(`${table}: not a list`);
    if (page.length === 0) return rows;
    for (const row of page as unknown[]) {
      // RLS (or the filter, for the service read) already scopes every read; this keeps a mistake out of the file.
      if (isRecord(row) && row.user_id === userId) rows.push(row);
    }
    offset += page.length;
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The caller's auth record, as Auth answers it for their own token; `RefusedSession` when Auth refuses that session. */
async function accountOf(context: Context): Promise<DataExport['account']> {
  const response = await fetchWithDeadline(
    context.fetchFn,
    `${context.env.supabaseUrl}/auth/v1/user`,
    { headers: userHeaders(context.env, context.auth) },
    POSTGREST_TIMEOUT_MS,
  );
  let user: unknown = null;
  try {
    user = await response.json();
  } catch {
    user = null;
  }
  if (sessionRefused(response.status, user)) throw new RefusedSession();
  if (!response.ok) throw new UpstreamError(`auth user: HTTP ${String(response.status)}`);
  if (!isRecord(user) || typeof user.id !== 'string' || user.id.toLowerCase() !== context.userId) {
    throw new UpstreamError('auth user: not the caller');
  }
  const providers = isRecord(user.app_metadata) && Array.isArray(user.app_metadata.providers) ? (user.app_metadata.providers as unknown[]) : [];
  return {
    email: textOrNull(user.email),
    createdAt: textOrNull(user.created_at),
    lastSignInAt: textOrNull(user.last_sign_in_at),
    providers: providers.filter((provider): provider is string => typeof provider === 'string'),
  };
}

export async function handleExportData(request: Request, deps: ExportDataDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const body = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!body.ok) return bodyProblemReply(body.reason);

  const context: Context = { env: deps.env, fetchFn: deps.fetch, auth: caller.auth, userId: caller.userId };
  try {
    const [account, tables] = await Promise.all([
      accountOf(context),
      Promise.all(EXPORTED_TABLES.map(async (table) => [table, await readAll(context, table)] as const)),
    ]);
    const rows = new Map<Table, Row[]>(tables);
    const of = (table: Table): Row[] => rows.get(table) ?? [];
    const profile = of('profiles')[0] ?? null;
    const exported: DataExport = {
      schemaVersion: 1,
      exportedAt: new Date(now()).toISOString(),
      termsVersion: textOrNull(profile?.terms_version),
      aiConsentVersion: textOrNull(profile?.ai_consent_version),
      account,
      profile,
      episodes: of('episodes'),
      medications: of('medications'),
      doses: of('doses'),
      checkins: of('checkins'),
      agentNotes: of('agent_notes'),
      signals: of('signals'),
      entitlement: of('entitlements')[0] ?? null,
      usageCounters: of('usage_counters'),
      consentEvents: of('consent_events'),
      pushDevices: of('push_tokens'),
    };
    return reply('exported', 200, exported, {}, NO_STORE);
  } catch (error) {
    if (error instanceof RefusedSession) return reply('refused', 401, { error: 'unauthorized' });
    return reply('error', 500, { error: 'internal' });
  }
}
