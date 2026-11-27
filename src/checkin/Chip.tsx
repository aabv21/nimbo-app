import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** `radio` for one answer out of a few, `checkbox` for a toggle. */
  role: 'radio' | 'checkbox';
}

const MARK = 18;

/** A rounded answer chip, 48 pt tall; the mark shows only while it is selected, and its slot never moves the label. */
export function Chip({ label, selected, onPress, role }: ChipProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole={role}
        accessibilityLabel={label}
        accessibilityState={{ checked: selected }}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.chip, { borderColor: selected ? color.accent : color.border }, selected && { backgroundColor: tones.opaquePill }]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        {selected ? <Check size={MARK} color={color.text} /> : <View style={styles.markSlot} />}
        <Text style={[styles.label, { color: selected ? color.text : color.textMuted }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: controlHeight,
    paddingHorizontal: space[2],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  markSlot: { width: MARK, height: MARK },
  label: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
});
