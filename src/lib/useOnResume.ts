// Runs a callback when the app returns to the foreground and when the network comes back: the
// moments a failed read gets another try.
import * as Network from 'expo-network';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export type ResumeReason = 'foreground' | 'online';

/** The latest `callback` runs, told which moment it is; the first network report only sets the baseline. */
export function useOnResume(callback: (reason: ResumeReason) => void): void {
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') latest.current('foreground');
    });
    let wasOnline: boolean | null = null;
    const network = Network.addNetworkStateListener((event) => {
      const online = event.isConnected === true && event.isInternetReachable !== false;
      if (online && wasOnline === false) latest.current('online');
      wasOnline = online;
    });
    return () => {
      appState.remove();
      network.remove();
    };
  }, []);
}
