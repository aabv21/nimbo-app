import type { Href } from 'expo-router';

/**
 * Typed routes are generated from the route files (`.expo/types`, not committed), so a literal path or
 * a `{ pathname, params }` object is checked against a list that may be stale or absent; one cast here
 * keeps the call sites readable and compiling either way.
 */
export function toHref(href: string | { pathname: string; params?: Record<string, string> }): Href {
  return href as unknown as Href;
}
