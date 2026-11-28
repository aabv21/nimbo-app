import { Stack } from 'expo-router';

import { useTheme } from '../../ui/themeContext';

export default function EpisodeLayout(): React.JSX.Element {
  const { color } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }} />;
}
