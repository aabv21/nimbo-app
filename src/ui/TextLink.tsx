import { Pressable, StyleSheet, Text } from 'react-native';
import Animated from 'react-native-reanimated';

import { controlHeight, fonts, space, type } from './theme';
import { useTheme, useTones } from './themeContext';
import { usePressFeedback } from './usePressFeedback';

interface TextLinkProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Where it sits in its column: at the start of the text (the default) or centred under a button. */
  align?: 'start' | 'center';
  /** A stable English id for the Maestro flows; never copy. */
  testID?: string;
}

/** A quiet in-text action (forgot password, switch screen): 48 pt tall, labelled as a button. */
export function TextLink({ label, onPress, disabled = false, align = 'start', testID }: TextLinkProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={[align === 'center' ? styles.center : styles.start, scaleStyle]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.link}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Text style={[styles.label, { color: disabled ? color.textMuted : color.accentText }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  center: { alignSelf: 'center' },
  // A little side room, so the pressed tone reads as a shape around the words rather than a highlight.
  link: { minHeight: controlHeight, justifyContent: 'center', paddingHorizontal: space[1], marginHorizontal: -space[1], borderRadius: 8, overflow: 'hidden' },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
