// The shared frame of the intro and the setup steps: the progress bars, an optional Skip, the title and lede,
// the step's own content and its docked actions.
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { DockedScreen } from '../ui/DockedScreen';
import { Notice } from '../ui/Notice';
import { TextLink } from '../ui/TextLink';
import { controlHeight, fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';

/** The AI consent is the first of the six; the five setup steps follow it. */
export const SETUP_STEPS = 6;

/** The onboarding progress bars; the AI consent screen shows them too, as the first of the six. */
export function StepProgress({ done, total }: { done: number; total: number }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={t('onb.progress')} accessibilityValue={{ min: 0, max: total, now: done }} style={styles.bars}>
      {Array.from({ length: total }, (_, index) => (
        <View key={index} style={[styles.bar, { backgroundColor: index < done ? color.accent : color.border }]} />
      ))}
    </View>
  );
}

interface OnboardingStepProps {
  /** How many progress bars are filled, this step included. */
  done: number;
  total: number;
  onSkip?: () => void;
  title: string;
  lede?: string;
  /** A failed save, shown above the actions. */
  error?: string | undefined;
  children?: ReactNode;
  dock: ReactNode;
}

export function OnboardingStep({ done, total, onSkip, title, lede, error, children, dock }: OnboardingStepProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <DockedScreen dock={dock}>
      <View style={styles.top}>
        <StepProgress done={done} total={total} />
        {onSkip === undefined ? null : <TextLink testID="onboarding-skip" label={t('common.skip')} onPress={onSkip} />}
      </View>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {title}
        </Text>
        {lede === undefined ? null : <Text style={[styles.lede, { color: color.textMuted }]}>{lede}</Text>}
      </View>
      {children}
      {error === undefined ? null : <Notice tone="danger" title={error} />}
    </DockedScreen>
  );
}

/** Two actions side by side that wrap when a long label needs the room; the main one takes the larger share. */
export function DockRow({ children }: { children: ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

export const dockStyles = StyleSheet.create({
  half: { flexGrow: 1, flexBasis: 140 },
  main: { flexGrow: 2, flexBasis: 140 },
});

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: controlHeight },
  bars: { flexDirection: 'row', gap: 6 },
  bar: { width: 24, height: 4, borderRadius: 2 },
  head: { gap: space[2] },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  lede: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
