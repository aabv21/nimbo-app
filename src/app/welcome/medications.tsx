import { router } from 'expo-router';
import { ChevronRight, Plus } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../../auth/AuthProvider';
import { classLabelKey } from '../../cabinet/medicationLabels';
import { useMedications } from '../../cabinet/medicationStore';
import type { Medication } from '../../cabinet/medicationStore';
import { useI18n } from '../../i18n';
import { OnboardingStep, SETUP_STEPS } from '../../onboarding/OnboardingStep';
import { Button } from '../../ui/Button';
import { controlHeight, fonts, space, type } from '../../ui/theme';
import { useTheme, useTones } from '../../ui/themeContext';
import { usePressFeedback } from '../../ui/usePressFeedback';

function next(): void {
  router.push('/welcome/notifications');
}

function Row({ medication }: { medication: Medication }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const sub =
    medication.kind === 'acute'
      ? t('onb.meds.sub', { kind: t('cabinet.kind.acute'), class: t(classLabelKey(medication.medicationClass)) })
      : t('cabinet.kind.preventive');
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={medication.name}
        accessibilityHint={sub}
        onPress={() => {
          router.push({ pathname: '/cabinet/[id]', params: { id: medication.id } });
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.row, { borderColor: color.border }]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <View style={styles.rowMain}>
          <Text style={[styles.rowTitle, { color: color.text }]}>{medication.name}</Text>
          <Text style={[styles.sub, { color: color.textMuted }]}>{sub}</Text>
        </View>
        <ChevronRight size={20} color={color.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

export default function MedicationsStep(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { userId } = useAuth();
  const medications = useMedications(userId ?? '');

  return (
    <OnboardingStep
      done={4}
      total={SETUP_STEPS}
      onSkip={next}
      title={t('onb.meds.title')}
      lede={t('onb.meds.lede')}
      dock={<Button label={t('common.next')} onPress={next} />}
    >
      {medications.length === 0 ? null : (
        <View style={[styles.rows, { borderColor: color.border }]}>
          {medications.map((medication) => (
            <Row key={medication.id} medication={medication} />
          ))}
        </View>
      )}
      <Button
        variant="secondary"
        icon={Plus}
        label={t('cabinet.add')}
        onPress={() => {
          router.push({ pathname: '/cabinet/[id]', params: { id: 'new' } });
        }}
      />
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  rows: { borderTopWidth: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: controlHeight + space[1],
    paddingVertical: space[2],
    borderBottomWidth: 1,
    overflow: 'hidden',
  },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
});
