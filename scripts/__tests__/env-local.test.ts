/** @jest-environment node */
// scripts/__tests__/env-local.test.ts
import { readFileSync } from 'node:fs';

import { MOCK_CLAUDE_PORT, MOCK_JEV_PORT, toEnvFile } from '../env-local.ts';

const MOCK_URLS = 'TYPESAFE_BASE_URL=http://127.0.0.1:54518\nANTHROPIC_BASE_URL=http://127.0.0.1:54519\n';

test('maps supabase status env to the app and test variables in a fixed order', () => {
  expect(
    toEnvFile({ API_URL: 'http://127.0.0.1:54521', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'srv', DB_URL: 'postgresql://x' }),
  ).toBe(
    'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\nEXPO_PUBLIC_SUPABASE_ANON_KEY=anon\nSUPABASE_SERVICE_ROLE_KEY=srv\nSUPABASE_DB_URL=postgresql://x\n' + MOCK_URLS,
  );
});

test('refuses to write a half-configured env', () => {
  expect(() => toEnvFile({ API_URL: 'http://127.0.0.1:54521' })).toThrow(/ANON_KEY/);
});

describe('merging with an existing .env.local', () => {
  const statusEnv = { API_URL: 'http://127.0.0.1:54521', ANON_KEY: 'anon', SERVICE_ROLE_KEY: 'srv', DB_URL: 'postgresql://x' };

  test('keeps a non-Supabase key from the existing file (e.g. a Google client id)', () => {
    const existing =
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n' +
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
      'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=my-ios-id\n';

    const result = toEnvFile(statusEnv, existing);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n' +
        MOCK_URLS +
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
        'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=my-ios-id\n',
    );
  });

  test('replaces the four Supabase keys wherever they appear, never duplicating them', () => {
    const existing =
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id\n' +
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n';

    const result = toEnvFile(statusEnv, existing);

    const supabaseUrlOccurrences = result.split('\n').filter((line) => line.startsWith('EXPO_PUBLIC_SUPABASE_URL=')).length;
    expect(supabaseUrlOccurrences).toBe(1);
    expect(result).toContain('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=my-web-id');
    expect(result).toContain('EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521');
  });

  test('with no existing file, writes the four Supabase keys and the mock URLs', () => {
    const result = toEnvFile(statusEnv);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n' +
        MOCK_URLS,
    );
  });

  test('an existing file with only Supabase keys round-trips to just the four keys and the mock URLs', () => {
    const existing =
      'EXPO_PUBLIC_SUPABASE_URL=http://old\n' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY=old-anon\n' +
      'SUPABASE_SERVICE_ROLE_KEY=old-srv\n' +
      'SUPABASE_DB_URL=postgresql://old\n';

    const result = toEnvFile(statusEnv, existing);

    expect(result).toBe(
      'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\n' +
        'EXPO_PUBLIC_SUPABASE_ANON_KEY=anon\n' +
        'SUPABASE_SERVICE_ROLE_KEY=srv\n' +
        'SUPABASE_DB_URL=postgresql://x\n' +
        MOCK_URLS,
    );
  });
});

describe('the function secrets', () => {
  const statusEnv = { API_URL: 'http://127.0.0.1:54521', ANON_KEY: 'anon' };

  test('replaces stale mock URLs and keeps a hand-set API key, never writing a key itself', () => {
    const existing = 'TYPESAFE_BASE_URL=http://old\nANTHROPIC_API_KEY=sk-owner-set\n';
    const result = toEnvFile(statusEnv, existing);
    expect(result.split('\n').filter((line) => line.startsWith('TYPESAFE_BASE_URL='))).toEqual(['TYPESAFE_BASE_URL=http://127.0.0.1:54518']);
    expect(result).toContain('ANTHROPIC_API_KEY=sk-owner-set');
    expect(toEnvFile(statusEnv)).not.toMatch(/_API_KEY=/);
  });

  test('the edge runtime secrets in config.toml point at the same mock ports, with dummy keys', () => {
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
    const section = /\[edge_runtime\.secrets\]\n([\s\S]*?)(?:\n\[|$)/.exec(config)?.[1] ?? '';
    const secrets = new Map(
      [...section.matchAll(/^([A-Z_]+) = "([^"]*)"$/gm)].map((match): [string, string] => [match[1] ?? '', match[2] ?? '']),
    );
    expect(secrets.get('TYPESAFE_BASE_URL')).toBe(`http://host.docker.internal:${String(MOCK_JEV_PORT)}`);
    expect(secrets.get('ANTHROPIC_BASE_URL')).toBe(`http://host.docker.internal:${String(MOCK_CLAUDE_PORT)}`);
    // The Open-Meteo route shares the Jev mock's server.
    expect(secrets.get('OPEN_METEO_URL')).toBe(`http://host.docker.internal:${String(MOCK_JEV_PORT)}`);
    expect(secrets.get('TYPESAFE_API_KEY')).toBe('local-only-not-a-key');
    expect(secrets.get('ANTHROPIC_API_KEY')).toBe('local-only-not-a-key');
  });
});
