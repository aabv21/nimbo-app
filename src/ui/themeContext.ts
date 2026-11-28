// The resolved theme, readable without the auth layer, so a component test needs no provider.
import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';

import type { ThemeName } from '../profile/profileRepository';
import { resolveTheme } from './resolveTheme';
import { themeOf } from './theme';
import type { ThemeColors, ThemeTones } from './theme';

export interface ThemeState {
  name: ThemeName;
  /** The in-app reduce-motion switch; the OS setting is read by `useMotion`. */
  reduceMotion: boolean;
  forceDim: (on: boolean) => void;
}

export const ThemeContext = createContext<ThemeState | undefined>(undefined);

export function toSystemScheme(scheme: string | null | undefined): 'light' | 'dark' | null {
  return scheme === 'light' || scheme === 'dark' ? scheme : null;
}

const noop = (): void => undefined;

/** The provider's state; outside a `ThemeProvider`, Automatic with the phone's scheme. */
export function useThemeState(): ThemeState {
  const context = useContext(ThemeContext);
  const scheme = useColorScheme();
  if (context !== undefined) {
    return context;
  }
  return { name: resolveTheme('system', toSystemScheme(scheme), false), reduceMotion: false, forceDim: noop };
}

export function useTheme(): { name: ThemeName; color: ThemeColors; forceDim(on: boolean): void } {
  const { name, forceDim } = useThemeState();
  return { name, color: themeOf(name).color, forceDim };
}

export function useTones(): ThemeTones {
  return themeOf(useThemeState().name).tone;
}
