/** @jest-environment node */
// supabase/functions/_shared/__tests__/env.test.ts
import { readEnv } from '../env.ts';

const getter =
  (values: Record<string, string>) =>
  (name: string): string | undefined =>
    new Map(Object.entries(values)).get(name);

const SUPABASE = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
};

describe('readEnv', () => {
  test('reads the variables of each capability asked for', () => {
    expect(readEnv(getter({ ...SUPABASE, TYPESAFE_API_KEY: 'jev-key' }), ['supabase', 'jev'])).toEqual({
      supabaseUrl: 'https://x.supabase.co',
      anonKey: 'anon',
      serviceRoleKey: 'service',
      typesafeApiKey: 'jev-key',
      typesafeBaseUrl: 'https://api.typesafe.ai',
    });
  });

  test('jev: throws naming TYPESAFE_API_KEY when it is unset or empty', () => {
    expect(() => readEnv(getter(SUPABASE), ['jev'])).toThrow('missing env: TYPESAFE_API_KEY');
    expect(() => readEnv(getter({ TYPESAFE_API_KEY: '' }), ['jev'])).toThrow('missing env: TYPESAFE_API_KEY');
  });

  test('claude: throws naming ANTHROPIC_API_KEY when it is unset', () => {
    expect(() => readEnv(getter(SUPABASE), ['claude'])).toThrow('missing env: ANTHROPIC_API_KEY');
  });

  test.each([
    ['unset', {}],
    ['empty', { SUPABASE_URL: '' }],
  ])('throws on a missing SUPABASE_URL (%s), never passing it on blank', (_label, url) => {
    const values = { SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', ...url };
    expect(() => readEnv(getter(values), ['supabase'])).toThrow('missing env: SUPABASE_URL');
  });

  test('ignores the secrets of a capability it was not asked for', () => {
    const env = readEnv(getter(SUPABASE), ['supabase']);
    expect(env).not.toHaveProperty('anthropicApiKey');
    expect(env).not.toHaveProperty('typesafeApiKey');
  });

  test('the base URLs fall back to the hosted APIs when unset or empty', () => {
    const env = readEnv(getter({ TYPESAFE_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', TYPESAFE_BASE_URL: '' }), ['jev', 'claude']);
    expect(env.typesafeBaseUrl).toBe('https://api.typesafe.ai');
    expect(env.anthropicBaseUrl).toBe('https://api.anthropic.com');
  });

  test('a set base URL wins and loses its trailing slashes', () => {
    const env = readEnv(
      getter({
        TYPESAFE_API_KEY: 'k',
        ANTHROPIC_API_KEY: 'k',
        TYPESAFE_BASE_URL: 'http://host.docker.internal:54518/',
        ANTHROPIC_BASE_URL: 'http://host.docker.internal:54519//',
      }),
      ['jev', 'claude'],
    );
    expect(env.typesafeBaseUrl).toBe('http://host.docker.internal:54518');
    expect(env.anthropicBaseUrl).toBe('http://host.docker.internal:54519');
  });

  test('weather: OPEN_METEO_URL falls back to the hosted API and the key to empty, needing no secret', () => {
    expect(readEnv(getter({}), ['weather'])).toEqual({ openMeteoUrl: 'https://api.open-meteo.com', openMeteoApiKey: '' });
  });

  test('weather: a set OPEN_METEO_URL loses its trailing slash, and a set key is kept', () => {
    const env = readEnv(getter({ OPEN_METEO_URL: 'http://host.docker.internal:54518/', OPEN_METEO_API_KEY: 'k' }), ['weather']);
    expect(env).toEqual({ openMeteoUrl: 'http://host.docker.internal:54518', openMeteoApiKey: 'k' });
  });

  test('push: EXPO_PUSH_URL falls back to Expo’s API base and the access token to empty, needing no secret', () => {
    expect(readEnv(getter({}), ['push'])).toEqual({ expoPushUrl: 'https://exp.host/--/api/v2/push', expoAccessToken: '' });
  });

  test('push: a set EXPO_PUSH_URL loses its trailing slash, and a set access token is kept', () => {
    const env = readEnv(getter({ EXPO_PUSH_URL: 'http://host.docker.internal:54518/--/api/v2/push/', EXPO_ACCESS_TOKEN: 't' }), ['push']);
    expect(env).toEqual({ expoPushUrl: 'http://host.docker.internal:54518/--/api/v2/push', expoAccessToken: 't' });
  });

  test('monitor: MONITOR_SECRET is required, and an empty one counts as missing', () => {
    expect(readEnv(getter({ MONITOR_SECRET: 's' }), ['monitor'])).toEqual({ monitorSecret: 's' });
    expect(() => readEnv(getter({ MONITOR_SECRET: '' }), ['monitor'])).toThrow('missing env: MONITOR_SECRET');
  });
});
