import { Pressable, StyleSheet, Text } from 'react-native';

import { controlHeight, fonts, type } from './theme';
import { useTheme } from './themeContext';

interface TextLinkProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

/** A quiet in-text action (forgot password, switch screen): 48 pt tall, labelled as a button. */
export function TextLink({ label, onPress, disabled = false }: TextLinkProps): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={styles.link}
    >
      <Text style={[styles.label, { color: disabled ? color.textMuted : color.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { minHeight: controlHeight, justifyContent: 'center', alignSelf: 'flex-start' },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
