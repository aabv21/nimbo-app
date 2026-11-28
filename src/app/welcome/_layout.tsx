import { Stack } from 'expo-router';
import type { Href } from 'expo-router';

import { useAuth } from '../../auth/AuthProvider';
import { nextRoute } from '../../auth/gate';
import { useTheme } from '../../ui/themeContext';

// No back gesture: the two gates are answered, not skipped, and each setup step moves on with its own buttons.
// Each gate is registered only while it is the one due; the five setup steps together, once both are answered.
export default function WelcomeLayout(): React.JSX.Element {
  const { color } = useTheme();
  // Signed in here, so the intro flag never decides the target.
  const target = nextRoute(useAuth(), { introSeen: true });
  // A screen that stops being due hands over to the one that is, not to the group's alphabetically first screen.
  const due: Href = target === '/welcome/boundary' || target === '/welcome/ai-consent' || target === '/welcome/triggers' ? target : '/';
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Protected guard={target === '/welcome/boundary'} redirectTo={due}>
        <Stack.Screen name="boundary" />
      </Stack.Protected>
      <Stack.Protected guard={target === '/welcome/ai-consent'} redirectTo={due}>
        <Stack.Screen name="ai-consent" />
      </Stack.Protected>
      <Stack.Protected guard={target === '/welcome/triggers'} redirectTo={due}>
        <Stack.Screen name="triggers" />
        <Stack.Screen name="priority" />
        <Stack.Screen name="medications" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="location" />
      </Stack.Protected>
    </Stack>
  );
}
