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
    files: ['supabase/functions/**/__tests__/*.ts', 'src/i18n/__tests__/*.ts', 'src/ui/__tests__/*.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // These tests read jest.fn() mocks off a mocked client and load a fresh module per test with require().
    files: ['src/auth/__tests__/authService.test.ts', 'src/lib/__tests__/supabase.test.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // The Reanimated stand-in records a factory's shared values while it runs (the Babel plugin's job on
    // a device), which writes a module-level tracker during render and subscribes with a computed deps list.
    files: ['src/test/reanimatedMock.ts'],
    rules: { 'react-hooks/immutability': 'off', 'react-hooks/exhaustive-deps': 'off' },
  },
  {
    // jest.mock() factories are hoisted above imports, so they can only reach `require`.
    files: [
      'jest.setup.ts',
      'src/ui/__tests__/ThemeProvider.test.tsx',
      'src/__tests__/{boundary,ai-consent,consent-gate,smoke,profile}.test.tsx',
      'src/profile/__tests__/{useTimezoneSync,useProfileChange}.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
