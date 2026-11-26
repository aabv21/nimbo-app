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
  {
    // Tests index the pack and the catalogs by a locale or catalog name from a fixed tuple.
    files: ['supabase/functions/**/__tests__/*.ts', 'src/i18n/__tests__/*.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // jest.mock() factories are hoisted above imports, so they can only reach `require`.
    files: ['jest.setup.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
