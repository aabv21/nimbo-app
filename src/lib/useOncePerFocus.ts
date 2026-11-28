// A navigation a double tap would make twice runs once per visit: the screen must be focused again first.
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';

/** Wraps a press handler that opens another screen; a second call is dropped until this screen regains focus. */
export function useOncePerFocus(): (action: () => void) => void {
  const busy = useRef(false);
  useFocusEffect(
    useCallback(() => {
      busy.current = false;
    }, []),
  );
  return useCallback((action: () => void) => {
    if (busy.current) return;
    busy.current = true;
    action();
  }, []);
}
