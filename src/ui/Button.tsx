import { Ellipsis } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

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
  variant?: 'primary' | 'secondary';
  /** Crisis controls are 56 pt tall. */
  size?: 'regular' | 'crisis';
  icon?: ComponentType<IconProps>;
  disabled?: boolean;
  /** Shows `loadingLabel` with a static mark (no spinner loop) and ignores presses. */
  loading?: boolean;
  loadingLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
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
  style,
}: ButtonProps): React.JSX.Element {
  const { color } = useTheme();
  const tone = useTones();
  const [focused, setFocused] = useState(false);
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  const inactive = disabled && !loading;
  const primary = variant === 'primary';
  const fill = inactive ? tone.disabledFill : primary ? color.accent : 'transparent';
  const ink = inactive ? color.textMuted : primary ? color.onAccent : color.accentText;
  const edge = inactive || primary ? 'transparent' : color.textMuted;
  const pressedFill = primary ? tone.pressAccent : tone.pressSecondary;
  const shown = loading ? (loadingLabel ?? label) : label;
  const LeadIcon = loading ? Ellipsis : Icon;

  return (
    <Animated.View style={[scaleStyle, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shown}
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
        <View style={styles.row}>
          {LeadIcon === undefined ? null : <LeadIcon size={24} color={ink} />}
          <Text style={[styles.label, size === 'crisis' && styles.crisisLabel, { color: ink }]}>{shown}</Text>
        </View>
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
  // Labels wrap rather than truncate: a long pt or es label takes a second line.
  label: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22, textAlign: 'center' },
  crisisLabel: { fontSize: type.title, lineHeight: 27 },
});
