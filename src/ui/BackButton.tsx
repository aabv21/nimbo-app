import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { controlHeight } from './theme';
import { useTheme } from './themeContext';

/** `testID` is a stable English id for the Maestro flows; never copy. */
export function BackButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.back}>
      <ChevronLeft size={28} color={color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { minWidth: controlHeight, minHeight: controlHeight, justifyContent: 'center', alignSelf: 'flex-start' },
});
