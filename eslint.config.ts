import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: ['.expo/**', 'ios/**', 'android/**', 'dist/**', 'src/lib/database.types.ts'],
  },
  tseslint.configs.strictTypeChecked,
  security.configs.recommended,
  reactHooks.configs.flat['recommended-latest'],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    // Node tooling reads repo paths it builds itself, never a path from outside input.
    files: ['scripts/**/*.ts', 'integration/**/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
);
