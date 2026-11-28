import { motionFor } from '../motion';

test('day is full motion with the token durations', () => {
  expect(motionFor('day', false)).toEqual({ level: 'full', duration: { fast: 120, base: 220, slow: 400 } });
});

test('dim is subtle and 1.5 times slower', () => {
  expect(motionFor('dim', false)).toEqual({ level: 'subtle', duration: { fast: 180, base: 330, slow: 600 } });
});

test('dark moves like day', () => {
  expect(motionFor('dark', false)).toEqual(motionFor('day', false));
});

test.each(['day', 'dark', 'dim'] as const)('reduced motion is a 150 ms fade in %s', (name) => {
  expect(motionFor(name, true)).toEqual({ level: 'fade', duration: { fast: 150, base: 150, slow: 150 } });
});
