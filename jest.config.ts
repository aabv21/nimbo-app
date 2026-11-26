import { createRequire } from 'node:module';

import type { Config } from 'jest';

const require = createRequire(import.meta.url);

// `app` runs under jest-expo's React Native environment; later tasks add the plain-Node projects.
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
  ],
};

export default config;
