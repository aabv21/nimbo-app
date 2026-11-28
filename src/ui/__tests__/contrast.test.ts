// The accessibility audit's contrast pins (docs/audits/accessibility.md): every text token on every surface token, and
// every pair a component paints, in Day, Dark and Dim. Text needs 4.5:1; icons, marks and control edges 3:1.
import { contrast } from '../contrast';
import { themes } from '../theme';

const NAMES = ['day', 'dark', 'dim'] as const;

describe.each(NAMES)('%s', (name) => {
  const { color: c, tone } = themes[name];

  test('every text token reads at 4.5:1 on every surface token', () => {
    const texts = { text: c.text, textMuted: c.textMuted, accentText: c.accentText, danger: c.danger, warning: c.warning, positive: c.positive };
    const surfaces = { bg: c.bg, surface: c.surface };
    for (const [fg, ink] of Object.entries(texts)) {
      for (const [ground, paint] of Object.entries(surfaces)) {
        expect({ pair: `${fg} on ${ground}`, ratio: contrast(ink, paint) >= 4.5 }).toEqual({ pair: `${fg} on ${ground}`, ratio: true });
      }
    }
  });

  test('text on the filled and tinted component tones reads at 4.5:1', () => {
    const pairs: [string, string, string][] = [
      ['onAccent on accent (primary button)', c.onAccent, c.accent],
      ['onAccent on pressAccent (pressed primary)', c.onAccent, tone.pressAccent],
      ['onAccent on danger (delete button)', c.onAccent, c.danger],
      ['disabledInk on disabledFill (disabled button, composer placeholder)', tone.disabledInk, tone.disabledFill],
      ['text on noticeWarning', c.text, tone.noticeWarning],
      ['text on noticeDanger', c.text, tone.noticeDanger],
      ['text on opaquePill (info notice, chips, bubbles)', c.text, tone.opaquePill],
      ['accentText on noticeWarning (notice action)', c.accentText, tone.noticeWarning],
      ['accentText on noticeDanger (notice action)', c.accentText, tone.noticeDanger],
      ['accentText on opaquePill (notice action)', c.accentText, tone.opaquePill],
      ['text on pressSecondary (pressed rows)', c.text, tone.pressSecondary],
      ['tabCurrent on opaquePill (opaque tab bar)', tone.tabCurrent, tone.opaquePill],
      ['tabIdle on surface (opaque tab bar)', tone.tabIdle, c.surface],
    ];
    for (const [pair, fg, bg] of pairs) expect({ pair, ok: contrast(fg, bg) >= 4.5 }).toEqual({ pair, ok: true });
  });

  test('icons, marks and control edges reach 3:1 against what they sit on', () => {
    const pairs: [string, string, string][] = [
      ['info notice icon and edge (accent) on opaquePill', c.accent, tone.opaquePill],
      ['warning notice icon and edge on noticeWarning', c.warning, tone.noticeWarning],
      ['danger notice icon and edge on noticeDanger', c.danger, tone.noticeDanger],
      ['notice edges on bg', c.accent, c.bg],
      ['warning edge on bg', c.warning, c.bg],
      ['danger edge on bg', c.danger, c.bg],
      ["the boundary's health-group accent border on surface", c.accent, c.surface],
      ['secondary button, field and switch edges (textMuted) on bg', c.textMuted, c.bg],
      ['the same edges on surface', c.textMuted, c.surface],
      ['a checked chip edge (accent) on bg', c.accent, c.bg],
    ];
    for (const [pair, fg, bg] of pairs) expect({ pair, ok: contrast(fg, bg) >= 3 }).toEqual({ pair, ok: true });
  });
});
