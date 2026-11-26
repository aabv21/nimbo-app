import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { kvGet, kvSet } from '../lib/kv';
import type { Locale } from './index';

export type LocalePreference = Locale | 'system';

const LOCALE_PREFERENCE_KEY = 'locale-preference';

function isLocalePreference(value: string): value is LocalePreference {
  return value === 'system' || value === 'en' || value === 'es' || value === 'pt';
}

function readStoredPreference(): LocalePreference {
  const stored = kvGet(LOCALE_PREFERENCE_KEY);
  if (stored !== null && isLocalePreference(stored)) {
    return stored;
  }
  return 'system';
}

interface LocalePreferenceContextValue {
  preference: LocalePreference;
  setPreference: (preference: LocalePreference) => Promise<void>;
}

const LocalePreferenceContext = createContext<LocalePreferenceContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<LocalePreference>(readStoredPreference);

  const setPreference = useCallback((next: LocalePreference): Promise<void> => {
    kvSet(LOCALE_PREFERENCE_KEY, next);
    setPreferenceState(next);
    return Promise.resolve();
  }, []);

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return <LocalePreferenceContext.Provider value={value}>{children}</LocalePreferenceContext.Provider>;
}

/** The persisted preference; `'system'` outside an `I18nProvider` (e.g. an isolated component test). */
export function useLocalePreference(): LocalePreferenceContextValue {
  const context = useContext(LocalePreferenceContext);
  if (context !== undefined) {
    return context;
  }
  return { preference: 'system', setPreference: () => Promise.resolve() };
}

export function preferenceToLocale(preference: LocalePreference, deviceLocale: Locale): Locale {
  return preference === 'system' ? deviceLocale : preference;
}
