// The Edge Functions' environment, read once when each `index.ts` loads: the runtime injects the
// `SUPABASE_*` values, the rest are function secrets.

export type SupabaseEnv = { supabaseUrl: string; anonKey: string; serviceRoleKey: string };
export type JevEnv = { typesafeApiKey: string; typesafeBaseUrl: string };
export type ClaudeEnv = { anthropicApiKey: string; anthropicBaseUrl: string };
/** The key is empty on the free API and set on the commercial one (docs/architecture.md#signals-and-the-pressure-forecast). */
export type WeatherEnv = { openMeteoUrl: string; openMeteoApiKey: string };
/** Expo's push API base (`/send` and `/getReceipts` are appended); the access token is empty unless push security is on. */
export type PushEnv = { expoPushUrl: string; expoAccessToken: string };
/** The shared secret the monitor job sends from the Vault (`x-webhook-secret`). */
export type MonitorSecretEnv = { monitorSecret: string };

type Capabilities = {
  supabase: SupabaseEnv;
  jev: JevEnv;
  claude: ClaudeEnv;
  weather: WeatherEnv;
  push: PushEnv;
  monitor: MonitorSecretEnv;
};
export type Capability = keyof Capabilities;

type Intersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
export type EnvOf<C extends Capability> = Intersection<Capabilities[C]>;

/** A variable: required unless it has a `fallback`; a `url` loses its trailing slashes. */
type Variable = { name: string; fallback?: string; url?: true };

const VARIABLES: { [C in Capability]: Record<keyof Capabilities[C], Variable> } = {
  supabase: {
    supabaseUrl: { name: 'SUPABASE_URL', url: true },
    anonKey: { name: 'SUPABASE_ANON_KEY' },
    serviceRoleKey: { name: 'SUPABASE_SERVICE_ROLE_KEY' },
  },
  jev: {
    typesafeApiKey: { name: 'TYPESAFE_API_KEY' },
    typesafeBaseUrl: { name: 'TYPESAFE_BASE_URL', fallback: 'https://api.typesafe.ai', url: true },
  },
  claude: {
    anthropicApiKey: { name: 'ANTHROPIC_API_KEY' },
    anthropicBaseUrl: { name: 'ANTHROPIC_BASE_URL', fallback: 'https://api.anthropic.com', url: true },
  },
  weather: {
    openMeteoUrl: { name: 'OPEN_METEO_URL', fallback: 'https://api.open-meteo.com', url: true },
    openMeteoApiKey: { name: 'OPEN_METEO_API_KEY', fallback: '' },
  },
  push: {
    expoPushUrl: { name: 'EXPO_PUSH_URL', fallback: 'https://exp.host/--/api/v2/push', url: true },
    expoAccessToken: { name: 'EXPO_ACCESS_TOKEN', fallback: '' },
  },
  monitor: {
    monitorSecret: { name: 'MONITOR_SECRET' },
  },
};

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

/** The variables of every capability in `needs`; throws `missing env: NAME` (never the value) for a required one that's unset or empty. */
export function readEnv<const C extends Capability>(get: (name: string) => string | undefined, needs: readonly C[]): EnvOf<C> {
  const env = new Map<string, string>();
  const wanted = new Set<string>(needs);
  for (const [capability, variables] of Object.entries(VARIABLES)) {
    if (!wanted.has(capability)) continue;
    for (const [field, variable] of Object.entries<Variable>(variables)) {
      const value = get(variable.name) ?? '';
      const resolved = value === '' ? variable.fallback : value;
      if (resolved === undefined) throw new Error(`missing env: ${variable.name}`);
      env.set(field, variable.url === true ? trimSlash(resolved) : resolved);
    }
  }
  return Object.fromEntries(env) as EnvOf<C>;
}
