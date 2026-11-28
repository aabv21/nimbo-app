// The label of an attack's logged key, from the condition pack; null for a key this build does not know.
import { packs } from '../condition';
import type { CatalogName } from '../condition';
import type { MessageKey } from '../i18n';

export function catalogLabelKey(catalog: CatalogName, key: string): MessageKey | null {
  const item = packs.migraine[catalog].find((candidate) => candidate.key === key);
  // The pack's label keys are catalog keys, which a catalogs test enforces.
  return item === undefined ? null : (item.labelKey as MessageKey);
}
