// The accessibility audit's source pins over the app's components (docs/audits/accessibility.md): text scales with the
// OS setting, and every Pressable says what it is and, when it shows no words, what it does.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Every component under `src/`, tests and their mocks left out, as [path relative to the repo, text]. */
function components(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.tsx') && !/(^|\/)(__tests__|test)\//.test(path))
    .sort()
    .map((path) => [relative(ROOT, join(SRC, path)), readFileSync(join(SRC, path), 'utf8')]);
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** The index of the `>` that closes the JSX opening tag starting at `start`: braces and quoted strings skipped. */
function tagEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (depth === 0 && (char === '"' || char === "'")) {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    } else if (char === '>' && depth === 0) {
      return index;
    }
  }
  throw new Error(`An unclosed tag at ${String(start)}`);
}

interface Pressable {
  where: string;
  tag: string;
  children: string;
}

function pressables(): Pressable[] {
  return components().flatMap(([path, text]) =>
    [...text.matchAll(/<Pressable\b/g)].map((match) => {
      const end = tagEnd(text, match.index);
      const tag = text.slice(match.index, end + 1);
      const children = tag.endsWith('/>') ? '' : text.slice(end + 1, text.indexOf('</Pressable>', end));
      return { where: `${path}:${String(lineOf(text, match.index))}`, tag, children };
    }),
  );
}

test('the scan reads the components it pins', () => {
  // A broken walk would pass every rule below on an empty list.
  expect(components().length).toBeGreaterThan(50);
  expect(pressables().length).toBeGreaterThan(30);
});

test('no text opts out of the OS text size', () => {
  const hits = components().flatMap(([path, text]) => [...text.matchAll(/allowFontScaling=\{false\}/g)].map((match) => `${path}:${String(lineOf(text, match.index))}`));
  expect(hits).toEqual([]);
});

test('no text caps its growth below 1.5×', () => {
  const hits = components().flatMap(([path, text]) =>
    [...text.matchAll(/maxFontSizeMultiplier=\{([^}]+)\}/g)]
      .filter((match) => {
        const value = Number(match[1]);
        // A named constant is read from its declaration in the same file.
        const named = new RegExp(`const ${match[1] ?? ''} = ([\\d.]+)`).exec(text);
        return (Number.isNaN(value) ? Number(named?.[1]) : value) < 1.5;
      })
      .map((match) => `${path}:${String(lineOf(text, match.index))}`),
  );
  expect(hits).toEqual([]);
});

test('every Pressable has an accessibilityRole', () => {
  expect(pressables().filter(({ tag }) => !/\baccessibilityRole=/.test(tag)).map(({ where }) => where)).toEqual([]);
});

test('every Pressable that shows no words has an accessibilityLabel', () => {
  const unnamed = pressables().filter(
    ({ tag, children }) => !/\baccessible=\{false\}/.test(tag) && !/\baccessibilityLabel=/.test(tag) && !/<(Animated\.)?Text\b/.test(children),
  );
  expect(unnamed.map(({ where }) => where)).toEqual([]);
});
