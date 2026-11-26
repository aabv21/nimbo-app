import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { controlHeight } from './theme';
import { useTheme } from './themeContext';

export function BackButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.back}>
      <ChevronLeft size={28} color={color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { minWidth: controlHeight, minHeight: controlHeight, justifyContent: 'center', alignSelf: 'flex-start' },
});
