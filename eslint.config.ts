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
    // These index a record by a medication class, or a check-in field, from a fixed tuple.
    files: ['supabase/functions/_shared/condition/{overuse,doseDays}.ts', 'src/checkin/checkinStore.ts', 'src/app/checkin.tsx'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // The insights index a bucket record by a day part, weekday or rule kind from a fixed tuple, and count arrays by position;
    // their card text reads the same records with the same keys, and its test walks the catalogs by locale.
    files: ['supabase/functions/_shared/insights.ts', 'src/insights/insightText.ts', 'src/insights/__tests__/insightText.test.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // The signal rules index a record by a medication class or a sleep band from a fixed tuple, and the forecast by position;
    // the push copy indexes its tables by a locale and a sleep band, both fixed unions.
    files: ['supabase/functions/_shared/{signals,pushCopy}.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // The calibration script and its test index a record by a guard key, a red-flag key or a fixture's position, and read
    // one environment variable by its name.
    files: ['scripts/calibrate.ts', 'scripts/__tests__/calibration.test.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // The screens index a record by a guard key, an intent or a red-flag key from a fixed tuple.
    files: ['supabase/functions/_shared/{screen,screenQuestions,screenFallback}.ts'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // These index a record by a catalog name, a form field or a period from a fixed tuple.
    files: ['src/history/{filterEpisodes,labels}.ts', 'src/app/episode/[[]id]/edit.tsx'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // These index a record by a locale or a dictation problem, both fixed unions.
    files: ['src/voice/{dictation,speech}.ts', 'src/companion/Composer.tsx'],
    rules: { 'security/detect-object-injection': 'off' },
  },
  {
    // A date field's accessible name is its label plus its value, so the test matches it by the catalog label.
    files: ['src/__tests__/episode.test.tsx'],
    rules: { 'security/detect-non-literal-regexp': 'off' },
  },
  {
    // The red-flag tests read the calibration fixtures from a path built from a fixed locale tuple.
    files: ['supabase/functions/**/__tests__/*.ts'],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
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
      'src/__tests__/{cabinet,crisis,checkin,history,episode,onboarding,today,sign-out,companion,memory}.test.tsx',
      'src/cabinet/__tests__/*.test.{ts,tsx}',
      'src/checkin/__tests__/*.test.{ts,tsx}',
      'src/episodes/__tests__/*.test.{ts,tsx}',
      'src/companion/__tests__/*.test.{ts,tsx}',
      'src/crisis/__tests__/{TellMe,WhatHelped}.test.tsx',
      'src/redflags/__tests__/*.test.tsx',
      'src/premium/__tests__/*.test.tsx',
      'src/profile/__tests__/{useTimezoneSync,useLanguageSync,useProfileChange,profileRepository}.test.ts',
      'src/profile/__tests__/NotificationSettings.test.tsx',
      'src/auth/__tests__/AuthProvider.test.tsx',
      'src/lib/{local,outbox,sync}/__tests__/*.test.{ts,tsx}',
      'src/insights/__tests__/*.test.{ts,tsx}',
      'src/signals/__tests__/useTodaySignals.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
