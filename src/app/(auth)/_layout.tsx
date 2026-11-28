import { Stack } from 'expo-router';

import { useTheme } from '../../ui/themeContext';

export default function AuthLayout(): React.JSX.Element {
  const { color } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
