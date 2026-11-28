// The security audit's source pins over the app (docs/audits/security.md): no service-role key, only the public
// EXPO_PUBLIC_* values, no console line but one dev warning, routes that carry ids and flags only, and the .gitignore.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Every file under `src/` as [path relative to the repo, text]; `tests` false leaves out the tests and their mocks. */
function sources(tests: boolean): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((path) => join(SRC, path))
    .filter((path) => /\.(ts|tsx|json)$/.test(path))
    .filter((path) => tests || !/\/(__tests__|test)\//.test(path))
    .sort()
    .map((path) => [relative(ROOT, path), readFileSync(path, 'utf8')]);
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

test('no file under src/, tests included, names the service-role key', () => {
  const hits = sources(true).filter(([path, text]) => path !== 'src/__tests__/securityScan.test.ts' && /service[_-]?role/i.test(text));
  expect(hits.map(([path]) => path)).toEqual([]);
});

test('the app reads only the public EXPO_PUBLIC_* values: the Supabase URL, the anon key and the Google client ids', () => {
  const names = new Set(sources(false).flatMap(([, text]) => [...text.matchAll(/process\.env\.(\w*[A-Z0-9])\b/g)].map((match) => match[1] ?? '')));
  expect([...names].sort()).toEqual([
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_URL',
  ]);
});

test('the only console line in the app is the dev-only Google setup warning, which carries no value', () => {
  const calls = sources(false).flatMap(([path, text]) =>
    [...text.matchAll(/console\.\w+\(/g)].map((match) => ({ path, line: lineOf(text, match.index), before: text.slice(Math.max(0, match.index - 40), match.index) })),
  );
  expect(calls.map(({ path }) => path)).toEqual(['src/auth/socialAuth.ts']);
  const [call] = calls;
  expect(call?.before).toMatch(/if \(__DEV__\) \{\s*$/);
  const source = readFileSync(join(ROOT, 'src/auth/socialAuth.ts'), 'utf8').split('\n');
  const warning = source.slice((call?.line ?? 1) - 1, (call?.line ?? 1) + 2).join('\n');
  expect(warning).toMatch(/console\.warn\(\s*'[^'$`]*',?\s*\);/);
});

// Limits, since these read text rather than types: they check param keys, not the values passed; a `params: { … }` object
// must sit on one line; and `<Link href={{ … }}>` objects are not read (today the only `href` is `<Redirect>` to a gate
// target in src/app/index.tsx). A navigation written another way needs its own line here.
describe('routes and deep links (scheme nimbo)', () => {
  // A route param is an id, a fixed flag or the address a sign-in code goes to; never words a person typed.
  const PARAMS = new Set(['id', 'debrief', 'filter', 'email', 'sent']);

  test('every dynamic route segment is [id]', () => {
    const segments = readdirSync(join(SRC, 'app'), { recursive: true, encoding: 'utf8' }).flatMap((path) => [...path.matchAll(/\[[^\]]+\]/g)].map((match) => match[0]));
    expect(new Set(segments)).toEqual(new Set(['[id]']));
  });

  test('every screen reads only the listed params', () => {
    const read = sources(false).flatMap(([path, text]) =>
      [...text.matchAll(/useLocalSearchParams<\{([^}]*)\}>/g)].flatMap((match) =>
        [...(match[1] ?? '').matchAll(/(\w+)\??:/g)].map((key) => `${path}: ${key[1] ?? ''}`),
      ),
    );
    expect(read.length).toBeGreaterThan(5);
    expect(read.filter((entry) => !PARAMS.has(entry.split(': ')[1] ?? ''))).toEqual([]);
    // Only the auth screen reads a non-id: the address it shows and sends a code to on a tap.
    expect(read.filter((entry) => entry.endsWith(': email'))).toEqual(['src/app/(auth)/confirm-email.tsx: email']);
  });

  test('every navigation passes only the listed params, and a path builds in nothing but an id', () => {
    const links = sources(false).filter(([, text]) => /<Link\b|href=\{\{/.test(text)).map(([path]) => path);
    expect(links).toEqual([]);
    const passed = sources(false).flatMap(([path, text]) =>
      // `params: { … }`, or `params: cond ? { … } : { … }`: every object literal up to the closing parenthesis.
      [...text.matchAll(/params: ([^\n]*\})\s*\)/g)].flatMap((match) =>
        [...(match[1] ?? '').matchAll(/\{([^}]*)\}/g)].map((object) => object[1]).flatMap((object) =>
          (object ?? '')
            .split(',')
            .map((pair) => pair.split(':')[0]?.trim() ?? '')
            .filter((key) => key !== '')
            .map((key) => `${path}: ${key}`),
        ),
      ),
    );
    expect(passed.length).toBeGreaterThan(10);
    expect(passed).toContain('src/app/(tabs)/companion.tsx: id');
    expect(passed.filter((entry) => entry.startsWith('src/app/(auth)/sign-in.tsx'))).toEqual([
      'src/app/(auth)/sign-in.tsx: email',
      'src/app/(auth)/sign-in.tsx: sent',
      'src/app/(auth)/sign-in.tsx: email',
      'src/app/(auth)/sign-in.tsx: email',
      'src/app/(auth)/sign-in.tsx: sent',
    ]);
    expect(passed.filter((entry) => !PARAMS.has(entry.split(': ')[1] ?? ''))).toEqual([]);
    const built = sources(false).flatMap(([path, text]) =>
      [...text.matchAll(/router\.\w+\(`([^`]*)`\)/g)].flatMap((match) => [...(match[1] ?? '').matchAll(/\$\{([^}]*)\}/g)].map((part) => `${path}: ${part[1] ?? ''}`)),
    );
    expect(built.length).toBeGreaterThan(0);
    expect(built.filter((entry) => !entry.endsWith(': id'))).toEqual([]);
    const withQuery = sources(false).flatMap(([path, text]) => [...text.matchAll(/router\.\w+\('([^']*\?[^']*)'\)/g)].map((match) => `${path}: ${match[1] ?? ''}`));
    expect(withQuery).toEqual(['src/cabinet/OveruseNotice.tsx: /history?filter=doses']);
  });
});

test('.gitignore keeps keys and local env files out: Firebase admin keys, env files, keystores and native folders', () => {
  const ignored = new Set(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((line) => line.trim()));
  for (const pattern of ['*-firebase-adminsdk-*.json', 'service-account*.json', '.env', '.env*.local', 'supabase/functions/.env', '*.keystore', '*.jks', '*.p8', '*.p12', '*.key', '*.pem', '/ios', '/android']) {
    expect({ pattern, ignored: ignored.has(pattern) }).toEqual({ pattern, ignored: true });
  }
});
