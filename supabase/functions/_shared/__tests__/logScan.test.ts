/** @jest-environment node */
// The security audit's source pins over the Edge Functions (docs/audits/security.md): what reaches a log line, where the
// service role is used, which functions the gateway's JWT check guards, and that no function answers CORS.
import { readdirSync, readFileSync } from 'node:fs';

const FUNCTIONS_DIR = new URL('../../', import.meta.url);
const CONFIG_TOML = new URL('../../../config.toml', import.meta.url);

/** Every non-test source file under `supabase/functions/`, as [path relative to it, text]. */
function sources(): [string, string][] {
  const files = readdirSync(FUNCTIONS_DIR, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts') && !path.endsWith('.d.ts') && !path.split('/').includes('__tests__'))
    .sort();
  return files.map((path) => [path, readFileSync(new URL(path, FUNCTIONS_DIR), 'utf8')]);
}

const OPEN = new Set(['(', '{', '[']);
const CLOSE = new Set([')', '}', ']']);

/** The top-level arguments of the call whose `(` is at `start`, as source text; quotes and template literals kept whole. */
function callArguments(text: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === "'" || char === '"' || char === '`') {
      const end = text.indexOf(char, index + 1);
      current += text.slice(index, end + 1);
      index = end;
      continue;
    }
    if (OPEN.has(char)) {
      depth += 1;
      if (depth === 1) continue;
    } else if (CLOSE.has(char)) {
      depth -= 1;
      if (depth === 0) {
        if (current.trim() !== '') args.push(current.trim());
        return args;
      }
    } else if (char === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  throw new Error('unbalanced call');
}

/** Every call of `reply(` in the sources (not its definition), with where it is and its arguments. */
function replyCalls(): { at: string; args: string[] }[] {
  return sources().flatMap(([path, text]) =>
    [...text.matchAll(/(?<![\w.])reply\(/g)]
      .filter((match) => !/function\s+$/.test(text.slice(Math.max(0, match.index - 10), match.index)))
      .map((match) => ({ at: `${path}:${String(text.slice(0, match.index).split('\n').length)}`, args: callArguments(text, match.index + 'reply'.length) })),
  );
}

// Names whose value is (or holds) something a caller sent or a person typed: none may reach a log word.
const CALLER_VALUES =
  /\b(userId|user_id|caller|auth|authorization|email|token|tokens|text|notes|note|name|message|messages|userText|body|input|dose_text|doseText|episodeId|nonce|code|secret|device_secret|profile|request)\b/;

/** The text with its string literals emptied: a fixed word may be anything, a name may not. */
const withoutLiterals = (text: string): string => text.replace(/'[^']*'/g, "''");

describe('log lines', () => {
  test('only reply() and two fixed outcome lines write to the console', () => {
    const consoleCalls = sources().flatMap(([path, text]) =>
      [...text.matchAll(/console\.(\w+)\(([^\n]*)\);/g)].map((match) => `${path}: console.${match[1] ?? ''}(${match[2] ?? ''})`),
    );
    expect(consoleCalls).toEqual([
      '_shared/http.ts: console.info(JSON.stringify({ outcome, ...words }))',
      "monitor/handler.ts: console.warn(JSON.stringify({ outcome: 'receipts_failed' }))",
      "push-unregister/handler.ts: console.info(JSON.stringify({ outcome: 'unregistered' }))",
    ]);
  });

  test('every reply() outcome is a fixed word', () => {
    const calls = replyCalls();
    expect(calls.length).toBeGreaterThan(30);
    const free = calls.filter(({ args }) => !/^('[a-z_]+'|[\w.]+ === '[a-z_]+' \? '[a-z_]+' : '[a-z_]+')$/.test(args[0] ?? ''));
    expect(free).toEqual([]);
  });

  test("no reply() words object names a caller's value (ids, tokens, text, the body)", () => {
    const leaks = replyCalls().filter(({ args }) => args[3] !== undefined && CALLER_VALUES.test(withoutLiterals(args[3])));
    expect(leaks).toEqual([]);
    // The companion builds its words through one helper: its fields are counts, sources and catalog keys.
    const helper = /const words = \(extra: Record<string, string>, round: number\): Record<string, string> => \(\{([^}]*)\}\);/.exec(
      readFileSync(new URL('companion/handler.ts', FUNCTIONS_DIR), 'utf8'),
    );
    expect(helper?.[1]).toBeDefined();
    expect(CALLER_VALUES.test(withoutLiterals(helper?.[1] ?? 'body'))).toBe(false);
  });

  test('every error reply carries a fixed error word and no detail', () => {
    const errors = replyCalls().filter(({ args }) => Number(args[1]) >= 400);
    expect(errors.length).toBeGreaterThan(15);
    const detailed = errors.filter(({ args }) => !/^\{ error: ('[a-z_]+'|invalidWord)(, quota: kind, limit)? \}$/.test(args[2] ?? ''));
    expect(detailed).toEqual([]);
  });
});

describe('the service role', () => {
  test('only these files send the service-role key, and each for the reason docs/audits/security.md gives', () => {
    const users = sources()
      .filter(([, text]) => /\bserviceHeaders\(/.test(text) && !text.includes('export function serviceHeaders('))
      .map(([path]) => path);
    expect(users).toEqual([
      '_shared/push.ts', // deleteTokens: Expo's dead tokens, for the monitor
      '_shared/quota.ts', // consume_quota, service-only, with the verified uid
      '_shared/weather.ts', // weather_cache, no client grant, for the monitor
      'delete-account/handler.ts', // the admin user delete of the verified uid
      'export-data/handler.ts', // usage_counters only
      'monitor/handler.ts', // the whole run: no user
      'push-claim/handler.ts', // the three claim RPCs, with the verified uid
      'push-unregister/handler.ts', // one push_tokens delete matched on token, account and device secret hash
    ]);
  });

  test('export-data reads one table with the service role: usage_counters', () => {
    const handler = readFileSync(new URL('export-data/handler.ts', FUNCTIONS_DIR), 'utf8');
    expect(handler.match(/service: true/g)).toHaveLength(1);
    expect(handler).toMatch(/\['usage_counters', \{ select: '\*', order: 'day,kind', service: true \}\]/);
  });

  test('the companion uses it only through consumeQuota, and only the monitor imports the weather and push senders', () => {
    const importers = (module: string): string[] =>
      sources()
        .filter(([path, text]) => !path.startsWith('_shared/') && text.includes(`from '../_shared/${module}'`))
        .map(([path]) => path);
    expect(importers('weather.ts')).toEqual(['monitor/handler.ts']);
    expect(importers('push.ts')).toEqual(['monitor/handler.ts', 'push-claim/handler.ts']);
    expect(readFileSync(new URL('companion/handler.ts', FUNCTIONS_DIR), 'utf8')).not.toMatch(/serviceHeaders|serviceRoleKey/);
  });
});

describe('the gateway JWT check', () => {
  const config = readFileSync(CONFIG_TOML, 'utf8');
  // Each `[functions.<name>]` header with the `verify_jwt` line under it and the comment lines right above it.
  const lines = config.split('\n');
  const sections = new Map(
    lines.flatMap((line, index) => {
      const name = /^\[functions\.([\w-]+)\]$/.exec(line)?.[1];
      if (name === undefined) return [];
      let first = index;
      while (first > 0 && (lines[first - 1] ?? '').startsWith('#')) first -= 1;
      const reason = lines.slice(first, index).join('\n').trim();
      return [[name, { verifyJwt: lines[index + 1] === 'verify_jwt = true', reason }] as const];
    }),
  );
  const functions = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .map((entry) => entry.name)
    .sort();

  test('every function has a config.toml section, and nothing else does', () => {
    expect(functions).toEqual(['companion', 'delete-account', 'export-data', 'monitor', 'push-claim', 'push-unregister']);
    expect([...sections.keys()].sort()).toEqual(functions);
  });

  test("a function that reads the caller's unverified sub (callerOf) has verify_jwt = true", () => {
    const readers = functions.filter((name) => readFileSync(new URL(`${name}/handler.ts`, FUNCTIONS_DIR), 'utf8').includes('callerOf('));
    expect(readers).toEqual(['companion', 'delete-account', 'export-data', 'push-claim']);
    expect(readers.filter((name) => sections.get(name)?.verifyJwt !== true)).toEqual([]);
  });

  test('verify_jwt = false only with a comment saying what checks the caller instead', () => {
    const open = [...sections].filter(([, section]) => !section.verifyJwt);
    expect(open.map(([name]) => name)).toEqual(['push-unregister', 'monitor']);
    expect(open.filter(([, section]) => section.reason === '')).toEqual([]);
    expect(readFileSync(new URL('monitor/handler.ts', FUNCTIONS_DIR), 'utf8')).toContain('secretMatches(');
    expect(readFileSync(new URL('push-unregister/handler.ts', FUNCTIONS_DIR), 'utf8')).toContain('device_secret_hash=eq.');
  });
});

test('no function answers CORS: the clients are the phone and pg_net, never a browser', () => {
  expect(sources().filter(([, text]) => /access-control-allow/i.test(text)).map(([path]) => path)).toEqual([]);
});
