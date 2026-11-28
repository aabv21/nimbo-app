// The motion audit's source pins (docs/audits/motion.md): every animation is Reanimated on the UI thread, and none of
// them animates layout, only transforms, opacity and the odd colour.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SRC = join(ROOT, 'src');

/** Every app source under `src/`, tests and their mocks left out, as [path relative to the repo, text]. */
function sources(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.tsx?$/.test(path) && !/(^|\/)(__tests__|test)\//.test(path))
    .sort()
    .map((path) => [relative(ROOT, join(SRC, path)), readFileSync(join(SRC, path), 'utf8')]);
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** The text of the call starting at `start` (a `useAnimatedStyle` factory, a `withTiming`): up to its closing parenthesis. */
function callBody(text: string, start: number): string {
  let depth = 0;
  for (let index = text.indexOf('(', start); index < text.length; index += 1) {
    const char = text.charAt(index);
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`An unclosed call at ${String(start)}`);
}

const LAYOUT_KEYS = /\b(width|height|top|left|right|bottom|margin\w*|padding\w*|flex\w*)\s*:/;

test('the scan reads the animated styles it pins', () => {
  expect(sources().filter(([, text]) => text.includes('useAnimatedStyle(')).length).toBeGreaterThan(5);
});

test("no file imports React Native's own Animated", () => {
  const hits = sources().filter(([, text]) => /import\s*\{[^}]*\bAnimated\b[^}]*\}\s*from\s*'react-native'/.test(text) || /import\s+Animated\s+from\s+'react-native'/.test(text));
  expect(hits.map(([path]) => path)).toEqual([]);
});

test('no animated style returns a layout property: width, height, position, margin, padding or flex', () => {
  const hits = sources().flatMap(([path, text]) =>
    [...text.matchAll(/useAnimatedStyle\(/g)].filter((match) => LAYOUT_KEYS.test(callBody(text, match.index))).map((match) => `${path}:${String(lineOf(text, match.index))}`),
  );
  expect(hits).toEqual([]);
});

test('no frame loop or interval drives what is on screen: clocks are minute timeouts', () => {
  const hits = sources().flatMap(([path, text]) =>
    [...text.matchAll(/\b(setInterval|requestAnimationFrame|withRepeat)\(/g)].map((match) => `${path}:${String(lineOf(text, match.index))}`),
  );
  expect(hits).toEqual([]);
});

test('every animation brings its own reduced variant: reduceMotion is never left to the system, which would skip the fade', () => {
  const calls = sources().flatMap(([path, text]) =>
    [...text.matchAll(/\b(withTiming|withSpring)\(/g)].filter((match) => !callBody(text, match.index).includes('reduceMotion')).map((match) => `${path}:${String(lineOf(text, match.index))}`),
  );
  const builders = sources().flatMap(([path, text]) =>
    text
      .split('\n')
      .flatMap((line, index) => (/\b(FadeIn|FadeOut|LinearTransition)\.\w+\(/.test(line) && !line.includes('.reduceMotion(') ? [`${path}:${String(index + 1)}`] : [])),
  );
  expect([...calls, ...builders]).toEqual([]);
});
