import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { fonts, space, type } from './theme';
import { useTheme, useTones } from './themeContext';
import { usePressFeedback } from './usePressFeedback';

interface SwitchRowProps {
  title: string;
  sub?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

const TRACK_WIDTH = 52;
const THUMB = 20;
const INSET = 5;
/** The thumb's travel inside the 1 pt border: the track less the thumb and both insets. */
const TRAVEL = TRACK_WIDTH - 2 - THUMB - INSET * 2;

/** A setting with an on/off switch; the whole row is the target. The thumb snaps: a 20 pt slide is more than Dim allows. */
export function SwitchRow({ title, sub, value, onChange, disabled = false }: SwitchRowProps): React.JSX.Element {
  const { color } = useTheme();
  const tone = useTones();
  const { pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      {...(sub === undefined ? {} : { accessibilityHint: sub })}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => {
        onChange(!value);
      }}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.row}
    >
      <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tone.pressSecondary }, pressedStyle]} />
      <View style={styles.main}>
        <Text style={[styles.title, { color: color.text }]}>{title}</Text>
        {sub === undefined ? null : <Text style={[styles.sub, { color: color.textMuted }]}>{sub}</Text>}
      </View>
      <View
        style={[
          styles.track,
          value ? { backgroundColor: color.accent, borderColor: color.accent } : { backgroundColor: color.bg, borderColor: color.textMuted },
        ]}
      >
        <View
          style={[
            styles.thumb,
            { backgroundColor: value ? color.onAccent : color.textMuted, transform: [{ translateX: value ? TRAVEL : 0 }] },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingVertical: space[2],
  },
  pressed: { ...StyleSheet.absoluteFill, marginHorizontal: -space[2], borderRadius: 8, opacity: 0 },
  main: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  track: { width: TRACK_WIDTH, height: 32, borderRadius: 16, borderWidth: 1, justifyContent: 'center', paddingHorizontal: INSET },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
});
