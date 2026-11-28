import { Ellipsis } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { ReduceMotion, withSpring, withTiming } from 'react-native-reanimated';
import type { EntryOrExitLayoutType } from 'react-native-reanimated';

import { mix } from './color';
import { crossFade, easingFor, spring, useMotion } from './motion';
import type { MotionPreset } from './motion';
import { controlHeight, crisisControlHeight, fonts, radius, space, type } from './theme';
import { useTheme, useTones } from './themeContext';
import { usePressFeedback } from './usePressFeedback';

export interface IconProps {
  size: number;
  color: string;
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  /** `danger` is the filled button of a destructive step (deleting the account), in place of the primary one. */
  variant?: 'primary' | 'secondary' | 'danger';
  /** Crisis controls are 56 pt tall. */
  size?: 'regular' | 'crisis';
  icon?: ComponentType<IconProps>;
  disabled?: boolean;
  /** Shows `loadingLabel` with a static mark (no spinner loop) and ignores presses. */
  loading?: boolean;
  loadingLabel?: string;
  accessibilityHint?: string;
  /** When the visible label needs context to stand alone, such as which medication a dose button logs. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** The label cross-fades when it changes (a saved confirmation), and in Day its icon settles from 0.9 to 1. */
  swap?: boolean;
  /** A stable English id for the Maestro flows; never copy. */
  testID?: string;
}

/** A check that settles from scale 0.9 on a spring; only at full motion, as the other levels have no scale. */
function settle(motion: MotionPreset): EntryOrExitLayoutType | undefined {
  if (motion.level !== 'full') return undefined;
  const duration = motion.duration.base;
  const fast = motion.duration.fast;
  const curve = easingFor(motion.level);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: 0.9 }] },
      animations: {
        opacity: withTiming(1, { duration: fast, easing: curve, reduceMotion: ReduceMotion.Never }),
        transform: [{ scale: withSpring(1, { duration, ...spring, reduceMotion: ReduceMotion.Never }) }],
      },
    };
  };
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  icon: Icon,
  disabled = false,
  loading = false,
  loadingLabel,
  accessibilityHint,
  accessibilityLabel,
  style,
  swap = false,
  testID,
}: ButtonProps): React.JSX.Element {
  const { color } = useTheme();
  const tone = useTones();
  const motion = useMotion();
  const checkIn = settle(motion);
  const [focused, setFocused] = useState(false);
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  const inactive = disabled && !loading;
  const danger = variant === 'danger';
  const filled = variant === 'primary' || danger;
  const fill = inactive ? tone.disabledFill : danger ? color.danger : filled ? color.accent : 'transparent';
  const ink = inactive ? tone.disabledInk : filled ? color.onAccent : color.accentText;
  const edge = inactive || filled ? 'transparent' : color.textMuted;
  // The danger fill darkens (or, in the dark themes, lightens) towards the text when pressed, like the accent's.
  const pressedFill = danger ? mix(color.danger, color.text, 0.86) : filled ? tone.pressAccent : tone.pressSecondary;
  const shown = loading ? (loadingLabel ?? label) : label;
  const LeadIcon = loading ? Ellipsis : Icon;

  return (
    <Animated.View style={[scaleStyle, style]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={loading ? shown : (accessibilityLabel ?? shown)}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        style={[
          styles.base,
          size === 'crisis' && styles.crisis,
          { backgroundColor: fill, borderColor: edge },
          focused && { outlineColor: color.accentText, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 3 },
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: pressedFill }, pressedStyle]} />
        {swap ? (
          <Animated.View key={shown} {...crossFade(motion)} style={[styles.row, styles.swapRow]}>
            {LeadIcon === undefined ? null : (
              <Animated.View {...(checkIn === undefined ? {} : { entering: checkIn })}>
                <LeadIcon size={24} color={ink} />
              </Animated.View>
            )}
            <Text style={[styles.label, { color: ink }]}>{shown}</Text>
          </Animated.View>
        ) : (
          <View style={styles.row}>
            {LeadIcon === undefined ? null : <LeadIcon size={24} color={ink} />}
            <Text style={[styles.label, size === 'crisis' && styles.crisisLabel, { color: ink }]}>{shown}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: controlHeight,
    justifyContent: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  crisis: { minHeight: crisisControlHeight },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1] },
  // The old and new label overlap while they cross-fade, so both sit centred over the button's own height.
  swapRow: { ...StyleSheet.absoluteFill, paddingHorizontal: space[4] },
  // Labels wrap rather than truncate: a long pt or es label takes a second line.
  label: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22, textAlign: 'center' },
  crisisLabel: { fontSize: type.title, lineHeight: 27 },
});
