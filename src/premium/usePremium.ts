import { useEffect, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { kvGet, kvSet } from '../lib/kv';
import { supabase } from '../lib/supabase';

interface PremiumState {
  userId: string | null;
  premium: boolean;
  loading: boolean;
}

function cachedAnswer(userId: string | null): boolean | null {
  if (userId === null) return null;
  const raw = kvGet(`premium.${userId}`);
  return raw === 'true' ? true : raw === 'false' ? false : null;
}

function initialState(userId: string | null): PremiumState {
  return { userId, premium: cachedAnswer(userId) ?? false, loading: userId !== null };
}

/**
 * Whether the signed-in user has premium: the server's answer, or the last one kept on the phone when
 * it cannot be reached. The cache is per user and holds a yes only until the next answer replaces it.
 */
export function usePremium(): { premium: boolean; loading: boolean } {
  const { userId } = useAuth();
  const [state, setState] = useState<PremiumState>(() => initialState(userId));

  // Another account starts from its own cache, never the previous user's answer.
  if (state.userId !== userId) {
    setState(initialState(userId));
  }

  useEffect(() => {
    if (userId === null) return;
    let current = true;
    const settle = (): void => {
      if (current) setState((previous) => ({ ...previous, loading: false }));
    };
    void Promise.resolve(supabase.rpc('has_premium', { p_user: userId })).then(({ data, error }) => {
      if (!current) return;
      if (error !== null) {
        settle();
        return;
      }
      kvSet(`premium.${userId}`, String(data));
      setState({ userId, premium: data, loading: false });
    }, settle);
    return () => {
      current = false;
    };
  }, [userId]);

  return { premium: state.premium, loading: state.loading };
}
