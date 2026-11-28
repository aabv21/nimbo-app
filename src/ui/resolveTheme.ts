import type { ThemeName, ThemePreference } from '../profile/profileRepository';

/** Crisis mode forces Dim; Automatic follows the phone and is Day when the phone reports nothing. */
export function resolveTheme(
  preference: ThemePreference,
  systemScheme: 'light' | 'dark' | null,
  forceDim: boolean,
): ThemeName {
  if (forceDim) return 'dim';
  if (preference !== 'system') return preference;
  return systemScheme === 'dark' ? 'dark' : 'day';
}
