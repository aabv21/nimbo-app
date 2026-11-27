// The 0–10 intensity control: eleven 56 pt steps in two rows, the chosen one ringed rather than filled.
import * as Haptics from 'expo-haptics';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { crossFade, easingFor, useMotion } from '../ui/motion';
import { crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';

const ROWS = [
  [0, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10],
] as const;

interface StepProps {
  step: number;
  label: string;
  selected: boolean;
  onPress: (step: number) => void;
}

function Step({ step, label, selected, onPress }: StepProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const motion = useMotion();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const on = useSharedValue(selected ? 1 : 0);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.get() }));

  // The old step's ring fades out while the new one fades in: moving it would travel more than 8 pt.
  useEffect(() => {
    on.set(withTiming(selected ? 1 : 0, { duration: motion.duration.fast, easing: easingFor(motion.level), reduceMotion: ReduceMotion.Never }));
  }, [on, selected, motion]);

  return (
    <Animated.View style={[styles.stepFrame, scaleStyle]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={label}
        accessibilityState={{ checked: selected }}
        onPress={() => {
          onPress(step);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.step, { borderColor: color.border }]}
      >
        <Animated.View pointerEvents="none" style={[styles.fill, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Animated.View
          pointerEvents="none"
          style={[styles.fill, styles.ring, { backgroundColor: tones.opaquePill, borderColor: color.accent }, ringStyle]}
        />
        <Text style={[styles.stepLabel, { color: selected ? color.text : color.textMuted }, selected && styles.stepLabelOn]}>{step}</Text>
      </Pressable>
    </Animated.View>
  );
}

interface IntensityScaleProps {
  /** Null until the first tap: no value is assumed for someone in pain. */
  value: number | null;
  onChange: (value: number) => void;
}

export function IntensityScale({ value, onChange }: IntensityScaleProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const fade = crossFade(motion);

  const labelOf = (step: number): string =>
    step === 0 ? t('crisis.intensity.low') : step === 10 ? t('crisis.intensity.high') : String(step);
  const choose = (step: number): void => {
    if (step === value) return;
    void Haptics.selectionAsync();
    onChange(step);
  };

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('crisis.intensity.label')}
        </Text>
        {value === null ? null : (
          <Animated.Text key={value} entering={fade.entering} exiting={fade.exiting} style={[styles.number, { color: color.text }]}>
            {value}
          </Animated.Text>
        )}
      </View>
      {value === null ? <Text style={[styles.small, { color: color.textMuted }]}>{t('crisis.intensity.unset')}</Text> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={t('crisis.intensity.group')} style={styles.rows}>
        {ROWS.map((row) => (
          <View key={row[0]} style={styles.row}>
            {row.map((step) => (
              <Step key={step} step={step} label={labelOf(step)} selected={step === value} onPress={choose} />
            ))}
          </View>
        ))}
      </View>
      {/* The ends are already in the first and last steps' labels. */}
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.ends}>
        <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.intensity.low')}</Text>
        <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.intensity.high')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space[2] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  number: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  rows: { gap: space[1] },
  row: { flexDirection: 'row', gap: space[1] },
  stepFrame: { flex: 1 },
  step: {
    minHeight: crisisControlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill, borderRadius: radius.control },
  ring: { borderWidth: 2 },
  stepLabel: { fontFamily: fonts.body, fontSize: type.title, lineHeight: 27 },
  stepLabelOn: { fontFamily: fonts.bodyBold },
  ends: { flexDirection: 'row', justifyContent: 'space-between' },
});
