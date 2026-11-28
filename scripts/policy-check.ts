// `pnpm policy:check`: the three privacy policies share their section anchors and every anchor the app links to, and
// no owner placeholder is left. Exits 1 until the owner fills them, so nothing is published half-filled.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const POLICY_FILES: readonly string[] = [
  'docs/privacy-policy.md',
  'docs/privacy-policy.es.md',
  'docs/privacy-policy.pt.md',
];

/** In page order; the app's `policyUrl` anchors and the Play Console deletion URL point at these. */
export const POLICY_ANCHORS: readonly string[] = [
  'summary',
  'controller',
  'health-data-consent',
  'what-we-collect',
  'ai',
  'where-it-is-kept',
  'processors',
  'transfers',
  'retention',
  'your-rights',
  'delete-your-account',
  'security',
  'not-medical-advice',
  'changes',
  'contact',
];

/** The owner's answers the texts wait for; filling them is an owner-session step. */
export const POLICY_PLACEHOLDERS: readonly string[] = [
  'CONTROLLER_NAME',
  'CONTROLLER_COUNTRY',
  'DPO_NAME',
  'DB_REGION',
  'LAUNCH_COUNTRIES',
  'ANTHROPIC_RETENTION',
  'TYPESAFE_RETENTION',
  'BACKUPS',
  'INACTIVE_ACCOUNTS',
  'EMAIL_PROVIDER',
  'EMAIL_LOG_RETENTION',
  'AUTH_LOG_RETENTION',
  'POLICY_URL',
];

/** Named identically in every language, so a reader can match a recipient across the three texts. */
export const POLICY_PROCESSORS: readonly string[] = [
  'Supabase',
  'Anthropic',
  'TypeSafe',
  'Open-Meteo',
  'Expo',
  'Firebase Cloud Messaging',
  'Google',
];

export function anchorsOf(markdown: string): string[] {
  return Array.from(markdown.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g), (match) => match[1] ?? '');
}

export function placeholdersOf(markdown: string): string[] {
  const names = Array.from(markdown.matchAll(/\{\{([A-Z][A-Z0-9_]*)\}\}/g), (match) => match[1] ?? '');
  return [...new Set(names)];
}

/** The `PolicySection` union in `src/account/consent.ts`, read as text: `scripts` never imports app code. */
export function appAnchorsOf(consentSource: string): string[] {
  const union = /export type PolicySection =([^;]+);/.exec(consentSource)?.[1];
  if (union === undefined) return [];
  return Array.from(union.matchAll(/'([a-z0-9-]+)'/g), (match) => match[1] ?? '');
}

/** Everything wrong with one file except the listed placeholders, which `main` reports apart. */
export function policyProblems(markdown: string, appAnchors: readonly string[]): string[] {
  const anchors = anchorsOf(markdown);
  const problems: string[] = [];
  if (anchors.join(' ') !== POLICY_ANCHORS.join(' ')) {
    problems.push('the section anchors differ from POLICY_ANCHORS');
  }
  for (const anchor of appAnchors) {
    if (!anchors.includes(anchor)) problems.push(`the app links to #${anchor}, which is missing`);
  }
  for (const name of placeholdersOf(markdown)) {
    if (!POLICY_PLACEHOLDERS.includes(name)) problems.push(`unknown placeholder {{${name}}}`);
  }
  return problems;
}

function main(): number {
  const root = new URL('../', import.meta.url);
  // Fixed repo paths, never user input.
  const appAnchors = appAnchorsOf(readFileSync(new URL('src/account/consent.ts', root), 'utf8'));
  let failed = false;
  for (const path of POLICY_FILES) {
    const markdown = readFileSync(new URL(path, root), 'utf8');
    const problems = policyProblems(markdown, appAnchors);
    const left = placeholdersOf(markdown).filter((name) => POLICY_PLACEHOLDERS.includes(name));
    if (problems.length === 0 && left.length === 0) {
      console.log(`${path}: ok`);
      continue;
    }
    failed = true;
    console.log(`${path}:`);
    for (const problem of problems) console.log(`  ${problem}`);
    for (const name of left) console.log(`  placeholder {{${name}}}`);
  }
  return failed ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
