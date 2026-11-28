/** @jest-environment node */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogKeys, packs } from '../../supabase/functions/_shared/condition/index.ts';
import type { CatalogName } from '../../supabase/functions/_shared/condition/index.ts';
import { catalogKeysSql } from '../catalog-sql.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../supabase/migrations/', import.meta.url));
const CATALOGS: readonly CatalogName[] = ['painAreas', 'symptoms', 'triggers', 'reliefs'];

test('the generated SQL is deterministic and names every key of the four catalogs', () => {
  const sql = catalogKeysSql(packs.migraine);

  expect(catalogKeysSql(packs.migraine)).toBe(sql);
  for (const catalog of CATALOGS) {
    expect(sql).toContain(`when '${catalog}' then`);
    for (const key of catalogKeys(packs.migraine, catalog)) {
      // The generator does not escape quotes, so keys must stay plain.
      expect(key).toMatch(/^[a-z0-9_]+$/);
      expect(sql).toContain(`'${key}'`);
    }
  }
});

test('the latest migration that defines public.catalog_keys contains exactly catalogKeysSql(packs.migraine)', () => {
  const statements = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .flatMap((name) => {
      const text = readFileSync(`${MIGRATIONS_DIR}${name}`, 'utf8');
      return text.match(/create or replace function public\.catalog_keys[\s\S]*?\n\$\$;/g) ?? [];
    });

  expect(statements.at(-1)).toBe(catalogKeysSql(packs.migraine));
});
