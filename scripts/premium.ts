// `pnpm premium grant <email> [--note <text>] [--until YYYY-MM-DD]` | `pnpm premium revoke <email>`.
// Owner-only: needs SUPABASE_SERVICE_ROLE_KEY (never src/), and prints the entitlement row before and after.

import { fileURLToPath, pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '../src/lib/database.types';

export type PremiumCommand =
  | { action: 'grant'; email: string; note: string | null; until: string | null }
  | { action: 'revoke'; email: string };

const USAGE = 'Usage: pnpm premium grant <email> [--note <text>] [--until YYYY-MM-DD] | pnpm premium revoke <email>';
const ENV_FILE_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
const PAGE_SIZE = 200;

class UsageError extends Error {}

function usage(reason: string): UsageError {
  return new UsageError(`${reason}\n${USAGE}`);
}

/** The end of the given UTC day, so `--until 2027-01-01` includes that whole day; null for a date that does not exist. */
export function endOfDay(date: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = new Date(`${date}T23:59:59.999Z`);
  return Number.isNaN(end.getTime()) || end.toISOString().slice(0, 10) !== date ? null : end;
}

function untilTimestamp(until: string | null): string | null {
  return until === null ? null : (endOfDay(until)?.toISOString() ?? null);
}

/** Parses the arguments after `pnpm premium`; throws a usage error for anything else. */
export function parsePremiumArgs(argv: readonly string[], now: Date): PremiumCommand {
  const [action, email, ...rest] = argv;
  if (action !== 'grant' && action !== 'revoke') throw usage('Unknown or missing action.');
  if (email === undefined || email.startsWith('--')) throw usage('Missing email.');

  if (action === 'revoke') {
    if (rest.length > 0) throw usage('revoke takes only an email.');
    return { action, email };
  }

  let note: string | null = null;
  let until: string | null = null;
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = rest.slice(index, index + 2);
    if (flag !== '--note' && flag !== '--until') throw usage(`Unknown option ${String(flag)}.`);
    if (value === undefined || value.startsWith('--')) throw usage(`${flag} needs a value.`);
    if (flag === '--note') {
      note = value;
    } else {
      const end = endOfDay(value);
      if (end === null) throw usage('--until must be a real date as YYYY-MM-DD.');
      if (end.getTime() <= now.getTime()) throw usage('--until is already past.');
      until = value;
    }
  }
  return { action, email, note, until };
}

async function findUserId(client: SupabaseClient<Database>, email: string): Promise<string> {
  const wanted = email.toLowerCase();
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error !== null) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === wanted);
    if (match !== undefined) return match.id;
    if (data.users.length < PAGE_SIZE) throw new Error(`No user has the email ${email}.`);
  }
}

async function readRow(client: SupabaseClient<Database>, userId: string): Promise<unknown> {
  const { data, error } = await client.from('entitlements').select('*').eq('user_id', userId).maybeSingle();
  if (error !== null) throw error;
  return data;
}

/**
 * Grants or revokes the grant half of the entitlement; the `purchase_*` columns are never in the write, so a
 * purchase survives either. An omitted note keeps the one already stored.
 */
export async function runPremium(
  command: PremiumCommand,
  client: SupabaseClient<Database>,
): Promise<{ before: unknown; after: unknown }> {
  const userId = await findUserId(client, command.email);
  const before = await readRow(client, userId);
  const updatedAt = new Date().toISOString();

  const row =
    command.action === 'grant'
      ? {
          user_id: userId,
          granted: true,
          granted_until: untilTimestamp(command.until),
          updated_at: updatedAt,
          ...(command.note === null ? {} : { granted_note: command.note }),
        }
      : { user_id: userId, granted: false, granted_until: null, updated_at: updatedAt };

  const { error } = await client.from('entitlements').upsert(row, { onConflict: 'user_id' });
  if (error !== null) throw error;
  return { before, after: await readRow(client, userId) };
}

export interface PremiumDeps {
  createClient: (url: string, key: string) => SupabaseClient<Database>;
  now: () => Date;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** Runs the command and returns the exit code: 0 done, 1 not allowed or failed, 2 usage. */
export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  deps: PremiumDeps,
): Promise<number> {
  const key = env['SUPABASE_SERVICE_ROLE_KEY'];
  if (key === undefined || key === '') {
    deps.error('SUPABASE_SERVICE_ROLE_KEY is not set. Set it (and EXPO_PUBLIC_SUPABASE_URL) for the project you mean to change.');
    return 1;
  }
  const url = env['EXPO_PUBLIC_SUPABASE_URL'];
  if (url === undefined || url === '') {
    deps.error('EXPO_PUBLIC_SUPABASE_URL is not set.');
    return 1;
  }

  deps.error(`Target: ${new URL(url).host}`);

  let command: PremiumCommand;
  try {
    command = parsePremiumArgs(argv, deps.now());
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.error(error.message);
    return 2;
  }

  try {
    const { before, after } = await runPremium(command, deps.createClient(url, key));
    deps.log(JSON.stringify({ before, after }, null, 2));
    return 0;
  } catch (error) {
    deps.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  try {
    // Values already in the shell win, so the owner can point this at another project without editing the file.
    process.loadEnvFile(ENV_FILE_PATH);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  process.exitCode = await main(process.argv.slice(2), process.env, {
    createClient: (url, key) => createClient<Database>(url, key, { auth: { autoRefreshToken: false, persistSession: false } }),
    now: () => new Date(),
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
  });
}
