/** @jest-environment node */
import { readFileSync } from 'node:fs';

import {
  POLICY_ANCHORS,
  POLICY_FILES,
  POLICY_PLACEHOLDERS,
  POLICY_PROCESSORS,
  anchorsOf,
  appAnchorsOf,
  placeholdersOf,
  policyProblems,
} from '../policy-check.ts';

const ROOT = new URL('../../', import.meta.url);

function read(path: string): string {
  // Paths come from POLICY_FILES or this test, never from input.
  return readFileSync(new URL(path, ROOT), 'utf8');
}

const consentSource = read('src/account/consent.ts');

/** The version line's word in each language; the date after it is the same in all three. */
const VERSION_LABELS: ReadonlyMap<string, string> = new Map([
  ['docs/privacy-policy.md', 'Version'],
  ['docs/privacy-policy.es.md', 'Versión'],
  ['docs/privacy-policy.pt.md', 'Versão'],
]);

/** The literal, read with a regex: `scripts` never imports app code. */
function termsVersion(): string {
  const match = /export const TERMS_VERSION = '(\d{4}-\d{2}-\d{2})';/.exec(consentSource);
  if (match?.[1] === undefined) throw new Error('TERMS_VERSION not found in src/account/consent.ts');
  return match[1];
}

test('there are three policy files, one per language', () => {
  expect(POLICY_FILES).toEqual(['docs/privacy-policy.md', 'docs/privacy-policy.es.md', 'docs/privacy-policy.pt.md']);
});

describe.each(POLICY_FILES)('%s', (path) => {
  const markdown = read(path);

  test('has every section anchor, in order', () => {
    expect(anchorsOf(markdown)).toEqual(POLICY_ANCHORS);
  });

  test('uses only the listed placeholders', () => {
    for (const name of placeholdersOf(markdown)) {
      expect(POLICY_PLACEHOLDERS).toContain(name);
    }
  });

  test('has no other braces than its placeholders', () => {
    const withoutPlaceholders = markdown.replaceAll(/\{\{[A-Z][A-Z0-9_]*\}\}/g, '');
    expect(withoutPlaceholders).not.toMatch(/[{}]/);
  });

  test('names every processor', () => {
    for (const processor of POLICY_PROCESSORS) {
      expect(markdown).toContain(processor);
    }
  });

  test('carries the version line, equal to TERMS_VERSION', () => {
    expect(markdown).toContain(`${VERSION_LABELS.get(path) ?? 'missing label'} ${termsVersion()} · `);
    expect(termsVersion()).toBe('2026-12-01');
  });

  test('gives the contact address and never a percentage', () => {
    expect(markdown).toContain('hello.aabv21@gmail.com');
    expect(markdown).not.toMatch(/\d\s?%|%\s?\d/);
  });

  test('has every anchor the app links to', () => {
    for (const anchor of appAnchorsOf(consentSource)) {
      expect(anchorsOf(markdown)).toContain(anchor);
    }
  });

  test('has no problem other than the placeholders the owner fills', () => {
    expect(policyProblems(markdown, appAnchorsOf(consentSource))).toEqual([]);
  });
});

test('the three files use the same placeholders', () => {
  const [en, es, pt] = POLICY_FILES.map((path) => placeholdersOf(read(path)).toSorted());
  expect(es).toEqual(en);
  expect(pt).toEqual(en);
});

test('the placeholder list is the thirteen owner answers', () => {
  expect(POLICY_PLACEHOLDERS).toHaveLength(13);
  expect(new Set(POLICY_PLACEHOLDERS).size).toBe(13);
});

test('placeholdersOf keeps unique upper-snake names in order', () => {
  expect(placeholdersOf('a {{X_Y}} b {{X_Y}} {{lower}}')).toEqual(['X_Y']);
  expect(placeholdersOf('{{B}} {{A_1}} {{B}}')).toEqual(['B', 'A_1']);
});

test('anchorsOf reads the anchor ids in order', () => {
  expect(anchorsOf('<a id="one"></a>\n## One\ntext <a id="two-words"></a>')).toEqual(['one', 'two-words']);
});

test('appAnchorsOf reads the PolicySection union', () => {
  expect(appAnchorsOf("export type PolicySection = 'ai' | 'transfers' | 'delete-your-account';")).toEqual([
    'ai',
    'transfers',
    'delete-your-account',
  ]);
  expect(appAnchorsOf('no union here')).toEqual([]);
  expect(appAnchorsOf(consentSource)).toContain('ai');
});

test('policyProblems names a missing app anchor, a wrong order and an unknown placeholder', () => {
  const good = POLICY_ANCHORS.map((id) => `<a id="${id}"></a>`).join('\n');

  expect(policyProblems(good, ['ai'])).toEqual([]);
  expect(policyProblems(good, ['history'])).toEqual(['the app links to #history, which is missing']);
  expect(policyProblems(`${good}\n{{NOT_LISTED}}`, [])).toEqual(['unknown placeholder {{NOT_LISTED}}']);
  expect(policyProblems(POLICY_ANCHORS.toReversed().map((id) => `<a id="${id}"></a>`).join('\n'), [])).toEqual([
    'the section anchors differ from POLICY_ANCHORS',
  ]);
});
