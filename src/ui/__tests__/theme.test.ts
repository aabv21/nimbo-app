import { contrast, luminance } from '../contrast';
import { resolveTheme } from '../resolveTheme';
import { themes } from '../theme';

test.each(['day', 'dark', 'dim'] as const)('%s meets the contrast floor', (name) => {
  const c = themes[name].color;
  for (const [fg, bg] of [[c.text, c.bg], [c.text, c.surface], [c.textMuted, c.bg], [c.accentText, c.bg], [c.onAccent, c.accent], [c.onAccent, c.danger], [c.danger, c.bg]] as const) {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  }
  for (const mark of [c.accent, c.danger, c.warning]) expect(contrast(mark, c.bg)).toBeGreaterThanOrEqual(3);
});

test('dim stays under the luminance caps', () => {
  const { bg, ...rest } = themes.dim.color;
  expect(luminance(bg)).toBeLessThanOrEqual(0.02);
  for (const value of Object.values(rest)) expect(luminance(value)).toBeLessThanOrEqual(0.35);
});

test.each(['day', 'dark'] as const)('%s has no pure white', (name) => {
  for (const value of Object.values(themes[name].color)) expect(value.toLowerCase()).not.toBe('#ffffff');
});

test('dark reads comfortably and is not pure black', () => {
  const c = themes.dark.color;
  expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(10);
  expect(luminance(c.bg)).toBeLessThanOrEqual(0.03);
  expect(c.bg.toLowerCase()).not.toBe('#000000');
});

test.each([
  ['system', 'light', false, 'day'], ['system', 'dark', false, 'dark'], ['system', null, false, 'day'],
  ['day', 'dark', false, 'day'], ['dark', 'light', false, 'dark'], ['dim', 'light', false, 'dim'],
  ['system', 'dark', true, 'dim'], ['day', 'light', true, 'dim'],
] as const)('resolveTheme(%s, %s, forceDim=%s) is %s', (pref, scheme, force, expected) => {
  expect(resolveTheme(pref, scheme, force)).toBe(expected);
});

test('contrast of black on white is 21', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
});
