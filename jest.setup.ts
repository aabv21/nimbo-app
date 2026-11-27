import { Dimensions } from 'react-native';

// jest.mock()'s factory can only reference globals (incl. `require`), not a module-scoped import: https://jestjs.io/docs/jest-object#jestmockmodulename-factory-options
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en', regionCode: 'US', currencyCode: 'USD' }],
}));
// expo-network's native module is absent under Jest: online by default; a suite that tests
// connectivity mocks the module itself.
jest.mock('expo-network', () => ({
  useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
  addNetworkStateListener: () => ({ remove: () => undefined }),
  getNetworkStateAsync: () => Promise.resolve({ isConnected: true, isInternetReachable: true }),
}));
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

// The notifications module is native: every call settles at once with nothing scheduled and permission granted.
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  scheduleNotificationAsync: jest.fn((request: { identifier: string }) => Promise.resolve(request.identifier)),
  getPresentedNotificationsAsync: jest.fn(() => Promise.resolve([])),
  dismissNotificationAsync: jest.fn(() => Promise.resolve()),
}));

// Location is native: permission denied and no position unless a suite says otherwise.
jest.mock('expo-location', () => ({
  Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false, status: 'denied', canAskAgain: true, expires: 'never' })),
  getCurrentPositionAsync: jest.fn(() => Promise.reject(new Error('No position under Jest'))),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
}));

// expo-speech's native module is absent under Jest: an English, a Mexican Spanish and a Brazilian Portuguese voice;
// a suite that tests speaking sets these with `jest.mocked`.
jest.mock('expo-speech', () => ({
  VoiceQuality: { Default: 'Default', Enhanced: 'Enhanced' },
  getAvailableVoicesAsync: jest.fn(() =>
    Promise.resolve([
      { identifier: 'voice-en-us', name: 'Samantha', language: 'en-US', quality: 'Default' },
      { identifier: 'voice-es-mx', name: 'Paulina', language: 'es-MX', quality: 'Default' },
      { identifier: 'voice-pt-br', name: 'Luciana', language: 'pt-BR', quality: 'Default' },
    ]),
  ),
  speak: jest.fn(),
  stop: jest.fn(() => Promise.resolve()),
}));
// expo-speech-recognition's native module is absent under Jest: available, permission granted, no offline Android
// language pack; `src/test/dictation.ts` emits its events.
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    isRecognitionAvailable: jest.fn(() => true),
    supportsOnDeviceRecognition: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' })),
    getSupportedLocales: jest.fn(() => Promise.resolve({ locales: [], installedLocales: [] })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

// The date-time picker is native too; a stand-in that exposes its props.
jest.mock('@react-native-community/datetimepicker', () => require('./src/test/datetimepickerMock'));
jest.mock('react-native-reanimated', () => require('./src/test/reanimatedMock'));
// The worklets runtime is native; a callback scheduled back onto the JS thread runs at once.
jest.mock('react-native-worklets', () => ({
  scheduleOnRN: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    fn(...args);
  },
}));
// The glass and blur views render as plain views; a suite flips `isLiquidGlassAvailable` to reach the iOS 26 branch.
jest.mock('expo-glass-effect', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    GlassView: View,
    GlassContainer: View,
    isLiquidGlassAvailable: jest.fn(() => false),
    isGlassEffectAPIAvailable: jest.fn(() => true),
  };
});
jest.mock('expo-blur', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { BlurView: View, BlurTargetView: View };
});

// `expo-sqlite/kv-store` wraps a native SQLite database; under Jest there is no native module to
// back it, so replace it with a plain in-memory map that implements the same synchronous methods.
jest.mock('expo-sqlite/kv-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItemSync: (key: string): string | null => store.get(key) ?? null,
      setItemSync: (key: string, value: string): void => {
        store.set(key, value);
      },
      removeItemSync: (key: string): void => {
        store.delete(key);
      },
    },
  };
});

// React Native's Jest preset reports a font scale of 2, so every suite would render the large-text
// layouts; default to the standard text size and let a large-text test mock it explicitly.
Dimensions.set({
  window: { ...Dimensions.get('window'), fontScale: 1 },
  screen: { ...Dimensions.get('screen'), fontScale: 1 },
});
