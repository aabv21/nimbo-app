import { createRequire } from 'node:module';

import type { Config } from 'jest';

const require = createRequire(import.meta.url);

// `app` runs under jest-expo's React Native environment; the plain-Node projects stay out of
// jest-expo because its preset's lazy globals (`fetch`, `structuredClone`, ...) break a file's own
// `@jest-environment node` docblock at teardown.
const config: Config = {
  projects: [
    {
      displayName: 'app',
      preset: 'jest-expo',
      setupFiles: ['<rootDir>/jest.setup.ts'],
      testMatch: ['<rootDir>/src/**/*.test.[jt]s?(x)'],
      transformIgnorePatterns: [
        'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg))',
      ],
      moduleNameMapper: {
        // NOTE: lucide-react-native's `exports` map resolves the `react-native`/`browser`
        // condition to an ESM-only .mjs build that jest-expo's babel transform (`\.[jt]sx?$`)
        // does not match. Node's plain CJS resolution (no custom conditions) resolves the same
        // bare specifier to the package's CJS build instead, so reuse that path here. Upgrade
        // path: drop this once the package ships a transform-compatible entry or Jest's
        // resolver supports `.mjs` via babel.
        '^lucide-react-native$': require.resolve('lucide-react-native'),
      },
    },
    {
      // `scripts/` has no babel/TS transform of its own (no `.js`/`.mjs` sources, run with
      // Node's native type stripping). Jest 30's native ESM loader (Node 24.9+'s synchronous
      // `require(esm)`) loads these files directly: `extensionsToTreatAsEsm` marks `.ts` as ESM,
      // Node strips the types, and no CJS/transform path is involved.
      displayName: 'scripts',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/scripts/**/*.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
    },
    {
      // Supabase Edge Function logic under `supabase/functions/`: runtime-neutral TypeScript with
      // explicit `.ts` imports, loaded by Node's native type stripping like `scripts`. Only each
      // function's `index.ts` (never imported by a test) touches Deno.
      displayName: 'functions',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/supabase/functions/**/*.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
    },
    {
      // authService, profileRepository and the outbox against the running local stack. Same setup as `scripts`
      // (plain Node, native TS stripping); kept out of `pnpm test` (see `test:int`) because it needs
      // Docker and `.env.local`, not just `node_modules`.
      displayName: 'integration',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/integration/**/*.int.test.ts'],
      extensionsToTreatAsEsm: ['.ts'],
      transform: {},
      moduleNameMapper: {
        // `emailAuth.ts` and `pull.ts` default their `client` parameter to the real `src/lib/supabase.ts`
        // singleton, which loads native modules. Every integration test passes its own client, so this
        // stub throws if the default is ever used.
        '^(\\.\\./)+(lib/)?supabase$': '<rootDir>/integration/lib-supabase.stub.ts',
        // The local store runs on `node:sqlite` with expo-sqlite's synchronous API.
        '^expo-sqlite$': '<rootDir>/src/test/sqliteNode.ts',
        // `src/lib/kv.ts` wraps a native SQLite store; the profile cache gets a plain in-memory map.
        '^expo-sqlite/kv-store$': '<rootDir>/integration/kv-store.stub.ts',
        // The stores make their ids with expo-crypto's native module; Node's `randomUUID` stands in.
        '^expo-crypto$': '<rootDir>/integration/expo-crypto.stub.ts',
      },
    },
  ],
};

export default config;
