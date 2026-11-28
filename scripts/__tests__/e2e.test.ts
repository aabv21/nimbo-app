/** @jest-environment node */
// scripts/__tests__/e2e.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  adbPath,
  apiPort,
  bootedSimulators,
  connectedEmulators,
  e2eEmail,
  e2ePassword,
  e2ePlatform,
  envValue,
  HOMEBREW_JAVA_HOME,
  javaEnvironment,
  MAILPIT_URL,
  maestroArgs,
  pickDevice,
  stackProblem,
} from '../e2e.ts';

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

describe('e2ePassword', () => {
  test('is 16 URL-safe characters, fresh on every run', () => {
    expect(e2ePassword(new Uint8Array(12).fill(255))).toBe('________________');
    expect(e2ePassword()).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(e2ePassword()).not.toBe(e2ePassword());
  });
});

describe('e2eEmail', () => {
  test('is a fresh example.com address per run', () => {
    expect(e2eEmail(1_764_200_000_000)).toBe('e2e-1764200000000@example.com');
    expect(e2eEmail(1)).not.toBe(e2eEmail(2));
  });
});

describe('javaEnvironment', () => {
  const homebrewJava = join(HOMEBREW_JAVA_HOME, 'bin', 'java');

  test('keeps a JAVA_HOME that is already set', () => {
    const env = { JAVA_HOME: '/opt/jdk', PATH: '/usr/bin' };
    expect(javaEnvironment(env, () => true)).toEqual({ ok: true, env });
  });

  test("uses Homebrew's openjdk@17 when JAVA_HOME is unset, its bin first on PATH", () => {
    expect(javaEnvironment({ PATH: '/usr/bin' }, (path) => path === homebrewJava)).toEqual({
      ok: true,
      env: { JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: `${join(HOMEBREW_JAVA_HOME, 'bin')}${delimiter}/usr/bin` },
    });
  });

  test('treats an empty JAVA_HOME as unset', () => {
    expect(javaEnvironment({ JAVA_HOME: '', PATH: '' }, (path) => path === homebrewJava)).toEqual({
      ok: true,
      env: { JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: join(HOMEBREW_JAVA_HOME, 'bin') },
    });
  });

  test('says how to get Java when there is none', () => {
    const result = javaEnvironment({ PATH: '/usr/bin' }, () => false);
    expect(!result.ok && result.message).toMatch(/JAVA_HOME.*brew install openjdk@17/);
  });
});

describe('maestroArgs', () => {
  test('runs the flows on one device with the workspace config, the account and Mailpit', () => {
    expect(maestroArgs('emulator-5554', 'e2e-1@example.com', 'secret-pw')).toEqual([
      '--device',
      'emulator-5554',
      'test',
      '--config',
      '.maestro/config.yaml',
      '--env',
      'EMAIL=e2e-1@example.com',
      '--env',
      'PASSWORD=secret-pw',
      '--env',
      `MAILPIT_URL=${MAILPIT_URL}`,
      '.maestro/flows',
    ]);
  });

  test("Mailpit is the local stack's port", () => {
    expect(MAILPIT_URL).toBe('http://127.0.0.1:54524');
    expect(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8')).toMatch(/\[local_smtp\][^[]*\nport = 54524\n/);
  });
});

describe('e2ePlatform', () => {
  test('defaults to android and accepts ios', () => {
    expect(e2ePlatform(undefined)).toEqual({ ok: true, platform: 'android' });
    expect(e2ePlatform('')).toEqual({ ok: true, platform: 'android' });
    expect(e2ePlatform('android')).toEqual({ ok: true, platform: 'android' });
    expect(e2ePlatform('ios')).toEqual({ ok: true, platform: 'ios' });
    const other = e2ePlatform('windows');
    expect(!other.ok && other.message).toMatch(/use android or ios/);
  });
});

describe('devices', () => {
  test('lists only ready devices from adb devices', () => {
    const output = 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\toffline\n\n';
    expect(connectedEmulators(output)).toEqual([{ udid: 'emulator-5554', name: 'emulator-5554' }]);
    expect(connectedEmulators('List of devices attached\n\n')).toEqual([]);
  });

  test('lists only the booted simulators, and reads malformed output as none', () => {
    const list = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-26-5': [
          { udid: 'A', name: 'iPhone 17 Pro', state: 'Booted' },
          { udid: 'B', name: 'iPhone 17', state: 'Shutdown' },
        ],
      },
    });
    expect(bootedSimulators(list)).toEqual([{ udid: 'A', name: 'iPhone 17 Pro' }]);
    expect(bootedSimulators('not json')).toEqual([]);
    expect(bootedSimulators('{"devices":null}')).toEqual([]);
  });

  test('picks the only running device', () => {
    expect(pickDevice([{ udid: 'emulator-5554', name: 'emulator-5554' }], undefined, 'android')).toEqual({
      ok: true,
      device: { udid: 'emulator-5554', name: 'emulator-5554' },
    });
  });

  test('asks for E2E_DEVICE when several run, and matches it by id or name', () => {
    const two = connectedEmulators('List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n');
    const several = pickDevice(two, undefined, 'android');
    expect(!several.ok && several.message).toMatch(/E2E_DEVICE/);
    expect(pickDevice(two, 'emulator-5556', 'android')).toEqual({ ok: true, device: { udid: 'emulator-5556', name: 'emulator-5556' } });
  });

  test("says what to start when none runs, or the requested one doesn't", () => {
    const none = pickDevice([], undefined, 'android');
    expect(!none.ok && none.message).toMatch(/No Android emulator is running/);
    const noSimulator = pickDevice([], undefined, 'ios');
    expect(!noSimulator.ok && noSimulator.message).toMatch(/No iOS simulator is booted/);
    const missing = pickDevice([{ udid: 'emulator-5554', name: 'emulator-5554' }], 'emulator-5556', 'android');
    expect(!missing.ok && missing.message).toMatch(/E2E_DEVICE=emulator-5556 isn't running/);
  });

  test("adb comes from ANDROID_HOME, else Android Studio's default SDK", () => {
    expect(adbPath({ ANDROID_HOME: '/sdk' }, '/Users/me')).toBe(join('/sdk', 'platform-tools', 'adb'));
    expect(adbPath({}, '/Users/me')).toBe(join('/Users/me', 'Library', 'Android', 'sdk', 'platform-tools', 'adb'));
  });

  test('maps the Supabase API port into the emulator', () => {
    expect(apiPort('http://127.0.0.1:54521')).toBe('54521');
    expect(apiPort('https://example.supabase.co')).toBe('443');
  });
});

describe('stackProblem', () => {
  const status = JSON.stringify({ API_URL: 'http://127.0.0.1:54521', ANON_KEY: 'anon' });

  test('passes when the stack runs where the app points', () => {
    expect(stackProblem(status, 'http://127.0.0.1:54521')).toBeNull();
  });

  test('tolerates CLI notices around the JSON', () => {
    expect(stackProblem(`Stopped services: [x]\n${status}\nA new version is available`, 'http://127.0.0.1:54521')).toBeNull();
  });

  test('says to start the stack when `supabase status` failed or has no API URL', () => {
    expect(stackProblem(undefined, 'http://127.0.0.1:54521')).toMatch(/isn't running.*pnpm db:start/);
    expect(stackProblem('{}', 'http://127.0.0.1:54521')).toMatch(/isn't running/);
    expect(stackProblem('garbage', 'http://127.0.0.1:54521')).toMatch(/Couldn't read/);
  });

  test('says to run env:local when the app points elsewhere or nowhere', () => {
    expect(stackProblem(status, undefined)).toMatch(/pnpm env:local/);
    expect(stackProblem(status, 'http://127.0.0.1:54321')).toMatch(/54321.*54521.*pnpm env:local/);
  });
});

describe('envValue', () => {
  test('reads one key from a dotenv file', () => {
    const text = 'EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54521\nOTHER=x=y\n';
    expect(envValue(text, 'EXPO_PUBLIC_SUPABASE_URL')).toBe('http://127.0.0.1:54521');
    expect(envValue(text, 'OTHER')).toBe('x=y');
    expect(envValue(text, 'MISSING')).toBeUndefined();
  });
});

function filesUnder(dir: string, match: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && match.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

describe('the flows', () => {
  const flows = filesUnder(join(ROOT, '.maestro'), /\.yaml$/).filter((file) => !file.endsWith('config.yaml'));
  const source = filesUnder(join(ROOT, 'src'), /\.tsx?$/)
    .filter((file) => !file.includes('__tests__') && !file.includes(join('src', 'test')))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  test('every id a flow selects is a testID in the app code', () => {
    const ids = flows.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/\bid: "([^"]+)"/g)].map((match) => match[1] ?? ''));
    expect(ids.length).toBeGreaterThan(20);
    const literals = new Set([...source.matchAll(/testID="([^"]+)"/g)].map((match) => match[1]));
    // A template id such as `tab-${tab.key}` matches any id that starts with its fixed part (`tab-profile`, `episode-row-.*`).
    const templates = [...source.matchAll(/testID=\{`([a-z-]+)\$\{/g)].map((match) => match[1] ?? '');
    const missing = ids.filter((id) => {
      const plain = id.replace(/\.\*$/, '');
      return !literals.has(plain) && !templates.some((prefix) => plain.startsWith(prefix));
    });
    expect(missing).toEqual([]);
  });

  test('each flow and subflow targets the app', () => {
    for (const file of flows) expect(readFileSync(file, 'utf8')).toMatch(/^appId: com\.aabv21\.nimbo$/m);
  });
});
