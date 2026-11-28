import { ChevronLeft } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { controlHeight } from './theme';
import { useTheme } from './themeContext';

/** `testID` is a stable English id for the Maestro flows; never copy. */
export function BackButton({
  label,
  onPress,
  testID,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.back}
    >
      <ChevronLeft size={28} color={disabled ? color.textMuted : color.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { minWidth: controlHeight, minHeight: controlHeight, justifyContent: 'center', alignSelf: 'flex-start' },
});
