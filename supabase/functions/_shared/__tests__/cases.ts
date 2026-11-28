// Loads the insight and signal fixtures in `fixtures/`, kept byte-identical to their source (docs/testing.md).
import { readFileSync } from 'node:fs';

export interface CaseFile<Case> {
  about: string;
  pack: Record<string, unknown>;
  cases: Case[];
}

export function readCases<Case extends { id: string }>(name: 'insights-cases.json' | 'signals-cases.json'): CaseFile<Case> {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8')) as CaseFile<Case>;
}
