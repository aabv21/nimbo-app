/** @jest-environment node */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function filesIn(dir: string, suffix: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith(suffix))
    .map((name) => join(dir, name))
    .sort();
}

const MARKDOWN = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', ...filesIn('docs', '.md')];

/** Markdown outside fenced code blocks and inline code, where a `](…)` is an example, not a link. */
function prose(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Every inline link and image target, without its title. */
function linksOf(markdown: string): string[] {
  return Array.from(prose(markdown).matchAll(/\]\(([^)\s]+)[^)]*\)/g), (match) => match[1] ?? '');
}

/** GitHub's heading ids: lowercase, punctuation dropped, each space a hyphen, a repeat suffixed `-1`, `-2`… */
function anchorsOf(markdown: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  for (const match of markdown.replace(/^```[\s\S]*?^```/gm, '').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const text = (match[1] ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    const slug = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    anchors.add(count === 0 ? slug : `${slug}-${String(count)}`);
  }
  for (const match of markdown.matchAll(/<a id="([^"]+)"><\/a>/g)) anchors.add(match[1] ?? '');
  return anchors;
}

/** A URL, or the policy's `{{POLICY_URL}}` placeholder that becomes one when the owner fills it. */
function isExternal(link: string): boolean {
  return /^[a-z]+:/i.test(link) || link.startsWith('{{');
}

/** What is wrong with one link from `from`, or null when it resolves. */
function problemOf(from: string, link: string): string | null {
  if (isExternal(link)) return null;
  const [path = '', anchor] = link.split('#');
  const target = path === '' ? from : normalize(join(dirname(from), decodeURI(path)));
  if (!existsSync(join(ROOT, target))) return `${from}: ${link} (no file ${target})`;
  if (anchor === undefined || anchor === '' || !target.endsWith('.md') || statSync(join(ROOT, target)).isDirectory()) return null;
  return anchorsOf(read(target)).has(anchor) ? null : `${from}: ${link} (no #${anchor} in ${target})`;
}

/** The repo paths a file links to, anchors dropped. */
function targetsOf(from: string): Set<string> {
  return new Set(
    linksOf(read(from))
      .filter((link) => !isExternal(link))
      .map((link) => normalize(join(dirname(from), decodeURI(link.split('#')[0] ?? '')))),
  );
}

test('the heading ids follow GitHub', () => {
  const anchors = anchorsOf('# How Nimbo works\n## Apple 5.1.3 `nimbo.db`\n## Steps\n## Steps\n<a id="ai"></a>\n```\n# not a heading\n```');
  expect([...anchors].sort()).toEqual(['ai', 'apple-513-nimbodb', 'how-nimbo-works', 'steps', 'steps-1']);
});

test('every relative link in the docs resolves to a file and, where given, an anchor', () => {
  const problems = MARKDOWN.flatMap((file) => linksOf(read(file)).map((link) => problemOf(file, link))).filter(
    (problem) => problem !== null,
  );
  expect(problems).toEqual([]);
});

test('every diagram page is linked from docs/architecture.md and AGENTS.md', () => {
  const architecture = targetsOf('docs/architecture.md');
  const agents = targetsOf('AGENTS.md');
  const pages = filesIn('docs/diagrams', '.html');
  expect(pages.length).toBeGreaterThan(0);
  expect(pages.filter((page) => !architecture.has(page))).toEqual([]);
  expect(pages.filter((page) => !agents.has(page))).toEqual([]);
});

test('every audit, the three privacy policies and the owner session are linked from AGENTS.md', () => {
  const agents = targetsOf('AGENTS.md');
  const required = [
    ...filesIn('docs/audits', '.md'),
    'docs/privacy-policy.md',
    'docs/privacy-policy.es.md',
    'docs/privacy-policy.pt.md',
    'docs/owner-session.md',
  ];
  expect(required.filter((file) => !agents.has(file))).toEqual([]);
});
