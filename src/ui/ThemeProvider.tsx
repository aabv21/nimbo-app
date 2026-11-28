import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { resolveTheme } from './resolveTheme';
import { themeOf } from './theme';
import { ThemeContext, toSystemScheme } from './themeContext';

export { useTheme } from './themeContext';

/** Resolves the appearance from the profile (Automatic while signed out) and lets crisis mode force Dim. */
export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { status, profile } = useAuth();
  const scheme = useColorScheme();
  const [forced, setForced] = useState(false);

  const signedInProfile = status === 'signedIn' ? profile : null;
  const name = resolveTheme(signedInProfile?.theme ?? 'system', toSystemScheme(scheme), forced);
  const reduceMotion = signedInProfile?.reduceMotion ?? false;

  const forceDim = useCallback((on: boolean) => {
    setForced(on);
  }, []);

  // The root view shows through during transitions and under the keyboard; keep it on the theme.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(themeOf(name).color.bg);
  }, [name]);

  const value = useMemo(() => ({ name, reduceMotion, forceDim }), [name, reduceMotion, forceDim]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
