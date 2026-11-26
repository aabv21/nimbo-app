import { Stack } from 'expo-router';

import { useAuth } from '../../auth/AuthProvider';
import { nextRoute } from '../../auth/gate';
import { useTheme } from '../../ui/themeContext';

// No back gesture: the two gates are answered, not skipped. Each screen is registered only while it is the one due.
export default function WelcomeLayout(): React.JSX.Element {
  const { color } = useTheme();
  const target = nextRoute(useAuth());
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Protected guard={target === '/welcome/boundary'}>
        <Stack.Screen name="boundary" />
      </Stack.Protected>
      <Stack.Protected guard={target === '/welcome/ai-consent'}>
        <Stack.Screen name="ai-consent" />
      </Stack.Protected>
    </Stack>
  );
}
