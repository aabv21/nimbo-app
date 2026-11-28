// Prints public.catalog_keys() from the condition pack, so the SQL lists cannot drift from the TypeScript ones.
// Paste the output into a new migration whenever a catalog changes.

import { pathToFileURL } from 'node:url';

import { catalogKeys, packs } from '../supabase/functions/_shared/condition/index.ts';
import type { CatalogName, ConditionPack } from '../supabase/functions/_shared/condition/index.ts';

const CATALOGS: readonly CatalogName[] = ['painAreas', 'symptoms', 'triggers', 'reliefs'];

export function catalogKeysSql(pack: ConditionPack): string {
  const branches = CATALOGS.map((catalog) => {
    const keys = catalogKeys(pack, catalog)
      .map((key) => `'${key}'`)
      .join(', ');
    return `    when '${catalog}' then array[${keys}]::text[]`;
  });
  return [
    'create or replace function public.catalog_keys(p_catalog text)',
    'returns text[]',
    'language sql',
    'immutable',
    "set search_path = ''",
    'as $$',
    '  select case p_catalog',
    ...branches,
    '  end;',
    '$$;',
  ].join('\n');
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(catalogKeysSql(packs.migraine));
}
