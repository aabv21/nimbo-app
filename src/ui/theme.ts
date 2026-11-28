// The design tokens (colours, type, space, radii) and the per-theme component tones derived from them.
import type { ThemeName } from '../profile/profileRepository';
import { alpha, mix } from './color';

export type ThemeColors = {
  bg: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accentText: string;
  onAccent: string;
  border: string;
  positive: string;
  warning: string;
  danger: string;
};

/** Component colours mixed from the tokens; each theme tunes its own (Dim stays under its luminance cap). */
export interface ThemeTones {
  pressAccent: string;
  pressSecondary: string;
  disabledFill: string;
  /** A disabled control's label: `textMuted`, a step lighter in Dim so it keeps 4.5:1 on `disabledFill`. */
  disabledInk: string;
  noticeWarning: string;
  noticeDanger: string;
  glassTop: string;
  glassBottom: string;
  glassEdge: string;
  glassHighlight: string;
  glassShadow: string;
  glassPill: string;
  glassPillEdge: string;
  tabCurrent: string;
  tabIdle: string;
  /** The opaque bar's raise when the OS asks to reduce transparency. */
  raise: string;
  opaquePill: string;
  opaquePillEdge: string;
}

const color: Record<ThemeName, ThemeColors> = {
  day: {
    bg: '#eff1e8',
    surface: '#f7f9f3',
    text: '#17251d',
    textMuted: '#4e594f',
    accent: '#2e5746',
    accentText: '#285140',
    onAccent: '#f4f6ef',
    border: '#a9aca3',
    positive: '#3b603d',
    warning: '#845922',
    danger: '#8e3f36',
  },
  dark: {
    bg: '#151b17',
    surface: '#1d241f',
    text: '#dde2d8',
    textMuted: '#98a298',
    accent: '#689e84',
    accentText: '#90c3aa',
    onAccent: '#101511',
    border: '#454d46',
    positive: '#94be94',
    warning: '#d9b47b',
    danger: '#db968d',
  },
  dim: {
    bg: '#080e0a',
    surface: '#111814',
    text: '#829989',
    textMuted: '#738578',
    accent: '#6c907c',
    accentText: '#729682',
    onAccent: '#070d09',
    border: '#2a332e',
    positive: '#779277',
    warning: '#a08962',
    danger: '#ad7671',
  },
};

function shared(c: ThemeColors): Pick<ThemeTones, 'pressSecondary' | 'disabledFill' | 'disabledInk' | 'noticeWarning' | 'noticeDanger' | 'opaquePill' | 'opaquePillEdge'> {
  return {
    pressSecondary: mix(c.accent, c.bg, 0.1),
    disabledFill: mix(c.textMuted, c.bg, 0.2),
    disabledInk: c.textMuted,
    noticeWarning: mix(c.warning, c.surface, 0.1),
    noticeDanger: mix(c.danger, c.surface, 0.1),
    opaquePill: mix(c.accent, c.surface, 0.12),
    opaquePillEdge: mix(c.accent, c.surface, 0.3),
  };
}

function dayTones(c: ThemeColors): ThemeTones {
  return {
    ...shared(c),
    pressAccent: mix(c.accent, c.text, 0.84),
    glassTop: alpha(c.surface, 0.78),
    glassBottom: alpha(c.surface, 0.64),
    glassEdge: alpha(c.text, 0.12),
    glassHighlight: alpha(c.surface, 0.96),
    glassShadow: `0px 1px 2px ${alpha(c.text, 0.06)}, 0px 10px 28px ${alpha(c.text, 0.12)}`,
    // The accent at 12 % over the surface at 80 %: the same paint as the design's nested mix.
    glassPill: alpha(mix(c.accent, c.surface, 0.146), 0.82),
    glassPillEdge: alpha(c.accent, 0.22),
    tabCurrent: c.accentText,
    tabIdle: c.textMuted,
    raise: `0px 1px 2px ${alpha(c.text, 0.06)}, 0px 6px 20px ${alpha(c.text, 0.07)}`,
  };
}

// Dark glass is a dark tint with a faint top highlight; its press fill gets lighter, not darker.
function darkTones(c: ThemeColors): ThemeTones {
  return {
    ...shared(c),
    pressAccent: mix(c.accent, c.text, 0.86),
    glassTop: alpha(c.surface, 0.86),
    glassBottom: alpha(c.bg, 0.84),
    glassEdge: alpha(c.text, 0.14),
    glassHighlight: alpha(c.text, 0.1),
    glassShadow: `0px 10px 28px ${alpha(c.onAccent, 0.45)}`,
    glassPill: alpha(c.accent, 0.16),
    glassPillEdge: alpha(c.accent, 0.34),
    tabCurrent: c.accentText,
    tabIdle: c.textMuted,
    raise: `0px 1px 2px ${alpha(c.onAccent, 0.4)}, 0px 6px 20px ${alpha(c.onAccent, 0.3)}`,
  };
}

// Dim glass is denser so tab labels keep 4.5:1 over any content behind it, with no glow or shadow;
// idle tabs sit a step above textMuted for the same reason.
function dimTones(c: ThemeColors): ThemeTones {
  return {
    ...shared(c),
    // Dim's textMuted reads 3.97:1 on the disabled fill; the placeholder of a disabled composer says why it is off.
    disabledInk: mix(c.text, c.textMuted, 0.6),
    pressAccent: mix(c.accent, c.bg, 0.9),
    glassTop: alpha(c.surface, 0.88),
    glassBottom: alpha(c.bg, 0.86),
    glassEdge: alpha(c.text, 0.16),
    glassHighlight: alpha(c.text, 0.09),
    glassShadow: 'none',
    glassPill: alpha(c.accent, 0.1),
    glassPillEdge: alpha(c.accent, 0.3),
    tabCurrent: c.text,
    tabIdle: mix(c.textMuted, c.text, 0.6),
    raise: 'none',
  };
}

export const themes: Record<ThemeName, { color: ThemeColors; tone: ThemeTones }> = {
  day: { color: color.day, tone: dayTones(color.day) },
  dark: { color: color.dark, tone: darkTones(color.dark) },
  dim: { color: color.dim, tone: dimTones(color.dim) },
};

/** The tokens of one theme; a switch rather than an index, so the name can never reach past the three. */
export function themeOf(name: ThemeName): { color: ThemeColors; tone: ThemeTones } {
  switch (name) {
    case 'day':
      return themes.day;
    case 'dark':
      return themes.dark;
    case 'dim':
      return themes.dim;
  }
}

export const type = { display: 28, title: 21, body: 17, label: 15, caption: 13 } as const;

/** space[0] is 4 pt, up to space[6] at 48 pt. */
export const space = [4, 8, 12, 16, 24, 32, 48] as const;

export const radius = { control: 12, card: 16, sheet: 24 } as const;

/** Families as `useFonts` registers them: one name per weight, since Android cannot pick a weight of a runtime font. */
export const fonts = {
  display: 'Literata_600SemiBold',
  displayRegular: 'Literata_400Regular',
  displayItalic: 'Literata_400Regular_Italic',
  body: 'AtkinsonHyperlegibleNext_400Regular',
  bodySemiBold: 'AtkinsonHyperlegibleNext_600SemiBold',
  bodyBold: 'AtkinsonHyperlegibleNext_700Bold',
} as const;

/** Controls are at least this tall; crisis controls use `crisisControlHeight`. */
export const controlHeight = 48;
export const crisisControlHeight = 56;
