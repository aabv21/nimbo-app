// `pnpm e2e` checks the local stack, starts Metro when it isn't running, and runs the Maestro flows on the Android
// emulator (`E2E_PLATFORM=ios` for the simulator). Checks and steps: docs/testing.md#end-to-end-flows-maestro.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const APP_ID = 'com.aabv21.nimbo';
/** Where Homebrew's keg-only `openjdk@17` lives on Apple silicon; used when `JAVA_HOME` is unset. */
export const HOMEBREW_JAVA_HOME = '/opt/homebrew/opt/openjdk@17';
export const METRO_STATUS_URL = 'http://127.0.0.1:8081/status';
/** The local stack's Mailpit (`supabase/config.toml`), where the sign-up flow reads its code. */
export const MAILPIT_URL = 'http://127.0.0.1:54524';
const METRO_READY_TIMEOUT_MS = 120_000;

/** A fresh password per run (16 URL-safe characters; the local stack wants 8 or more), so none is committed. */
export function e2ePassword(random: Uint8Array = randomBytes(12)): string {
  return Buffer.from(random).toString('base64url');
}

/** A new address per run (the epoch milliseconds), so no run meets an earlier run's account. */
export function e2eEmail(now: number): string {
  return `e2e-${String(now)}@example.com`;
}

export type Env = Readonly<Record<string, string | undefined>>;

export type JavaEnvironment = { ok: true; env: Env } | { ok: false; message: string };

/** Maestro's environment: `JAVA_HOME`, else Homebrew's `openjdk@17`, else how to get Java; never the shell profile. */
export function javaEnvironment(env: Env, exists: (path: string) => boolean): JavaEnvironment {
  const current = env.JAVA_HOME;
  if (current !== undefined && current !== '') return { ok: true, env };
  if (!exists(join(HOMEBREW_JAVA_HOME, 'bin', 'java'))) {
    return {
      ok: false,
      message: `Maestro needs Java 17: set JAVA_HOME, or install it with \`brew install openjdk@17\` (expected at ${HOMEBREW_JAVA_HOME}).`,
    };
  }
  const path = env.PATH ?? '';
  const bin = join(HOMEBREW_JAVA_HOME, 'bin');
  return {
    ok: true,
    env: { ...env, JAVA_HOME: HOMEBREW_JAVA_HOME, PATH: path === '' ? bin : `${bin}${delimiter}${path}` },
  };
}

/** `maestro test` on `udid`, with the workspace config, the run's account and where its sign-up code arrives. */
export function maestroArgs(udid: string, email: string, password: string, mailpitUrl: string = MAILPIT_URL): string[] {
  return [
    '--device',
    udid,
    'test',
    '--config',
    '.maestro/config.yaml',
    '--env',
    `EMAIL=${email}`,
    '--env',
    `PASSWORD=${password}`,
    '--env',
    `MAILPIT_URL=${mailpitUrl}`,
    '.maestro/flows',
  ];
}

export type E2ePlatform = 'ios' | 'android';

/** `E2E_PLATFORM`: `android` when unset, since the iOS run comes later. */
export function e2ePlatform(value: string | undefined): { ok: true; platform: E2ePlatform } | { ok: false; message: string } {
  if (value === undefined || value === '' || value === 'android') return { ok: true, platform: 'android' };
  if (value === 'ios') return { ok: true, platform: 'ios' };
  return { ok: false, message: `E2E_PLATFORM=${value}: use android or ios.` };
}

export type Device = { udid: string; name: string };

/** The booted simulators in `xcrun simctl list devices booted -j` output. */
export function bootedSimulators(listJson: string): Device[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(listJson);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || !('devices' in parsed)) return [];
  const { devices } = parsed;
  if (typeof devices !== 'object' || devices === null) return [];
  return Object.values(devices).flatMap((runtime: unknown) =>
    Array.isArray(runtime)
      ? runtime.flatMap((device: unknown) =>
          typeof device === 'object' &&
          device !== null &&
          'state' in device &&
          device.state === 'Booted' &&
          'name' in device &&
          typeof device.name === 'string' &&
          'udid' in device &&
          typeof device.udid === 'string'
            ? [{ udid: device.udid, name: device.name }]
            : [],
        )
      : [],
  );
}

/** The ready devices in `adb devices` output, as `{ udid: serial, name: serial }`. */
export function connectedEmulators(devicesOutput: string): Device[] {
  return devicesOutput
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .flatMap(([serial, state]) => (serial !== undefined && serial !== '' && state === 'device' ? [{ udid: serial, name: serial }] : []));
}

/**
 * The device `requested` (`E2E_DEVICE`: a serial, UDID or name) names, else the only running one. Several running
 * and none requested is an error, since Maestro would pick one arbitrarily.
 */
export function pickDevice(
  running: readonly Device[],
  requested: string | undefined,
  platform: E2ePlatform,
): { ok: true; device: Device } | { ok: false; message: string } {
  const list = running.map((device) => (device.name === device.udid ? device.udid : `${device.name} (${device.udid})`)).join(', ');
  if (requested !== undefined && requested !== '') {
    const match = running.find((device) => device.udid === requested || device.name === requested);
    return match === undefined
      ? { ok: false, message: `E2E_DEVICE=${requested} isn't running. Running: ${list === '' ? 'none' : list}.` }
      : { ok: true, device: match };
  }
  const [only, ...others] = running;
  if (only === undefined) {
    return {
      ok: false,
      message:
        platform === 'android'
          ? 'No Android emulator is running: start one, then run `pnpm android` once.'
          : 'No iOS simulator is booted: boot one, then run `pnpm ios` once.',
    };
  }
  if (others.length > 0) {
    return { ok: false, message: `Several devices are running (${list}): pick one with E2E_DEVICE=<id or name>.` };
  }
  return { ok: true, device: only };
}

/** `adb` in the Android SDK: `ANDROID_HOME`, else Android Studio's default `~/Library/Android/sdk`. */
export function adbPath(env: Env, home: string): string {
  const sdk = env.ANDROID_HOME !== undefined && env.ANDROID_HOME !== '' ? env.ANDROID_HOME : join(home, 'Library', 'Android', 'sdk');
  return join(sdk, 'platform-tools', 'adb');
}

/** The port of the app's Supabase URL, which `adb reverse` maps into the emulator. */
export function apiPort(appUrl: string): string {
  const url = new URL(appUrl);
  return url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port;
}

export function envValue(text: string, key: string): string | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}=`)) return trimmed.slice(key.length + 1);
  }
  return undefined;
}

/**
 * Why the local stack can't serve the flows, or null: `statusJson` is `supabase status -o json` output
 * (undefined when the stack is stopped), `appUrl` the app's bundled `EXPO_PUBLIC_SUPABASE_URL`.
 */
export function stackProblem(statusJson: string | undefined, appUrl: string | undefined): string | null {
  const start = 'Start the local stack with `pnpm db:start`, then run `pnpm env:local`.';
  if (statusJson === undefined) return `Local Supabase isn't running. ${start}`;
  let status: unknown;
  try {
    // The CLI can print notices around the JSON object.
    status = JSON.parse(statusJson.slice(statusJson.indexOf('{'), statusJson.lastIndexOf('}') + 1));
  } catch {
    return `Couldn't read \`supabase status\`. ${start}`;
  }
  const apiUrl = typeof status === 'object' && status !== null && 'API_URL' in status ? status.API_URL : undefined;
  if (typeof apiUrl !== 'string' || apiUrl === '') return `Local Supabase isn't running. ${start}`;
  if (appUrl === undefined) return 'No EXPO_PUBLIC_SUPABASE_URL in .env.local: run `pnpm env:local`.';
  if (appUrl !== apiUrl) {
    return `.env.local points the app at ${appUrl}, but the local stack is at ${apiUrl}: run \`pnpm env:local\` and restart Metro.`;
  }
  return null;
}

function repoRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

class CheckFailed extends Error {}

function run(command: string, args: readonly string[], env: Env): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync(command, args, { env: { ...process.env, ...env }, encoding: 'utf8', cwd: repoRoot() });
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr };
}

async function metroRunning(): Promise<boolean> {
  try {
    const response = await fetch(METRO_STATUS_URL, { signal: AbortSignal.timeout(3000) });
    return (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
}

/** Starts `pnpm start` in its own process group (stopped with it at the end) and waits until Metro answers. */
async function startMetro(): Promise<ChildProcess> {
  const child = spawn('pnpm', ['start'], { cwd: repoRoot(), env: { ...process.env, CI: '1' }, stdio: 'ignore', detached: true });
  const deadline = Date.now() + METRO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new CheckFailed(`\`pnpm start\` exited with ${String(child.exitCode)} before Metro was ready.`);
    if (await metroRunning()) return child;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  stopMetro(child);
  throw new CheckFailed(`Metro didn't answer on :8081 within ${String(METRO_READY_TIMEOUT_MS / 1000)} s.`);
}

function stopMetro(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGINT');
  } catch {
    // Already gone.
  }
}

type Target = Device & ({ platform: 'ios' } | { platform: 'android'; adb: string });

function checkPrerequisites(env: Env, platform: E2ePlatform): { target: Target; appUrl: string | undefined } {
  if (!run('maestro', ['--version'], env).ok) {
    throw new CheckFailed('Maestro is not on PATH: install it with `brew install maestro`.');
  }
  let target: Target;
  if (platform === 'android') {
    const adb = adbPath(env, homedir());
    const listed = run(adb, ['devices'], env);
    if (!listed.ok) throw new CheckFailed(`adb didn't run (${adb}): install the Android SDK or set ANDROID_HOME.`);
    const picked = pickDevice(connectedEmulators(listed.stdout), env.E2E_DEVICE, platform);
    if (!picked.ok) throw new CheckFailed(picked.message);
    target = { ...picked.device, platform, adb };
    if (!run(adb, ['-s', target.udid, 'shell', 'pm', 'path', APP_ID], env).stdout.includes('package:')) {
      throw new CheckFailed(`The dev build (${APP_ID}) isn't installed on ${target.name}: run \`pnpm android\`.`);
    }
  } else {
    const picked = pickDevice(bootedSimulators(run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], env).stdout), env.E2E_DEVICE, platform);
    if (!picked.ok) throw new CheckFailed(picked.message);
    target = { ...picked.device, platform };
    if (!run('xcrun', ['simctl', 'get_app_container', target.udid, APP_ID], env).ok) {
      throw new CheckFailed(`The dev build (${APP_ID}) isn't installed on ${target.name}: run \`pnpm ios\`.`);
    }
  }
  const status = run('pnpm', ['exec', 'supabase', 'status', '-o', 'json'], env);
  const envFile = join(repoRoot(), '.env.local');
  const appUrl = existsSync(envFile) ? envValue(readFileSync(envFile, 'utf8'), 'EXPO_PUBLIC_SUPABASE_URL') : undefined;
  const problem = stackProblem(status.ok ? status.stdout : undefined, appUrl);
  if (problem !== null) throw new CheckFailed(problem);
  return { target, appUrl };
}

async function runFlows(): Promise<number> {
  const java = javaEnvironment(process.env, existsSync);
  if (!java.ok) throw new CheckFailed(java.message);
  const platform = e2ePlatform(process.env.E2E_PLATFORM);
  if (!platform.ok) throw new CheckFailed(platform.message);
  const { target, appUrl } = checkPrerequisites(java.env, platform.platform);

  const metro = (await metroRunning()) ? null : await startMetro();
  try {
    if (target.platform === 'android' && appUrl !== undefined) {
      for (const port of ['8081', apiPort(appUrl)]) {
        const mapped = run(target.adb, ['-s', target.udid, 'reverse', `tcp:${port}`, `tcp:${port}`], java.env);
        if (!mapped.ok) throw new CheckFailed(`adb couldn't map port ${port} into ${target.name}: ${mapped.stderr.trim()}`);
      }
    }
    const email = e2eEmail(Date.now());
    console.log(`Running the flows on ${target.name} as ${email}`);
    const maestro = spawn('maestro', maestroArgs(target.udid, email, e2ePassword()), {
      cwd: repoRoot(),
      env: { ...process.env, ...java.env },
      stdio: 'inherit',
    });
    return await new Promise<number>((resolve) => {
      maestro.once('exit', (code) => {
        resolve(code ?? 1);
      });
      maestro.once('error', (error) => {
        console.error(error.message);
        resolve(1);
      });
    });
  } finally {
    if (metro !== null) stopMetro(metro);
  }
}

export function isEntryPoint(moduleUrl: string, invokedPath: string | undefined): boolean {
  return invokedPath !== undefined && moduleUrl === pathToFileURL(invokedPath).href;
}

// Guard the entry point so importing this module (e.g. from tests) has no side effects.
if (isEntryPoint(import.meta.url, process.argv[1])) {
  runFlows()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
