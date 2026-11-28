/** @jest-environment node */
import { createRefs } from '../refs.ts';

test('refs count per prefix, and the same id keeps its ref', () => {
  const refs = createRefs();
  expect(refs.add('e', 'episode-a')).toBe('e1');
  expect(refs.add('e', 'episode-b')).toBe('e2');
  expect(refs.add('m', 'med-a')).toBe('m1');
  expect(refs.add('e', 'episode-a')).toBe('e1');
  expect(refs.add('r', 'result-1')).toBe('r1');
  expect(refs.idOf('e2')).toBe('episode-b');
  expect(refs.idOf('m1')).toBe('med-a');
});

test('an unminted or malformed ref maps to nothing', () => {
  const refs = createRefs();
  refs.add('e', 'episode-a');
  expect(refs.idOf('e9')).toBeNull();
  expect(refs.idOf('m1')).toBeNull();
  expect(refs.idOf('E1')).toBeNull();
  expect(refs.idOf(' e1')).toBeNull();
  expect(refs.idOf('')).toBeNull();
});

test('two requests never share refs', () => {
  const first = createRefs();
  first.add('n', 'note-a');
  expect(createRefs().idOf('n1')).toBeNull();
});
