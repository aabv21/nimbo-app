/** @jest-environment node */
// The database's closed value lists against the TypeScript ones they mirror (docs/audits/database.md); the catalogs'
// keys are pinned by catalog-sql.test.ts.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { packs } from '../../supabase/functions/_shared/condition/index.ts';
import { DAILY_LIMITS } from '../../supabase/functions/_shared/quota.ts';
import { Constants } from '../../src/lib/database.types.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const sorted = (values: readonly string[]): string[] => [...values].sort();

test('the medication_class enum is the condition pack’s medication classes', () => {
  expect(sorted(Constants.public.Enums.medication_class)).toEqual(sorted(packs.migraine.medicationClasses));
});

test('the quota_kind enum is the kinds DAILY_LIMITS counts', () => {
  expect(sorted(Constants.public.Enums.quota_kind)).toEqual(sorted(Object.keys(DAILY_LIMITS)));
});

// Inline (`kind text not null check (kind in (…))`) or added later (`add constraint … check (kind in (…))`); a form this
// pattern misses still fails database_audit.test.sql 19-20, which read the live constraint.
test('the signals kind check lists every signal kind the pack ranks', () => {
  const checks = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .flatMap((name) => readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8').match(/check \(kind in \(([^)]*)\)\)/g) ?? [])
    .filter((check) => check.includes("'quiet_tracker'"));
  const kinds = [...(checks.at(-1) ?? '').matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');

  expect(sorted(kinds)).toEqual(sorted(packs.migraine.signals.priority));
});
