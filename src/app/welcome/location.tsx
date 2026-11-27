// The last setup step: an optional rough area for weather. Either button finishes onboarding on the phone (the
// outbox sends it), and the gate then opens Today on its own, online or not.
import { Gauge } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { captureCoarseLocation } from '../../onboarding/coarseLocation';
import { DockRow, OnboardingStep, SETUP_STEPS, dockStyles } from '../../onboarding/OnboardingStep';
import { completeOnboarding, updateProfile } from '../../profile/profileRepository';
import { Button } from '../../ui/Button';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

export default function LocationStep(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { userId, patchProfile } = useAuth();
  const [busy, setBusy] = useState<'allow' | 'skip' | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const finish = async (withArea: boolean): Promise<void> => {
    setFailed(false);
    setBusy(withArea ? 'allow' : 'skip');
    try {
      if (withArea) {
        const area = await captureCoarseLocation();
        // Optional, so a failed write never holds back the finish.
        if (area !== null) await updateProfile({ coarseLocation: area });
      }
      if (userId === null) return;
      try {
        patchProfile({ onboardingCompletedAt: completeOnboarding(userId) });
      } catch {
        // The local store refused the write: nothing was queued, so the step stays for another try.
        setFailed(true);
      }
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <OnboardingStep
      done={SETUP_STEPS}
      total={SETUP_STEPS}
      title={t('onb.loc.title')}
      lede={t('onb.loc.lede')}
      error={failed ? t('consent.error') : undefined}
      dock={
        <DockRow>
          <Button
            variant="secondary"
            label={t('common.not_now')}
            loading={busy === 'skip'}
            loadingLabel={t('common.saving')}
            disabled={busy === 'allow'}
            onPress={() => {
              void finish(false);
            }}
            style={dockStyles.half}
          />
          <Button
            label={t('onb.loc.allow')}
            loading={busy === 'allow'}
            loadingLabel={t('common.saving')}
            disabled={busy === 'skip'}
            onPress={() => {
              void finish(true);
            }}
            style={dockStyles.main}
          />
        </DockRow>
      }
    >
      <View style={styles.example}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
          {t('onb.loc.example')}
        </Text>
        {/* What the permission buys, shown as the signal it makes; an example, so it is not a control. */}
        <View style={[styles.signal, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Gauge size={24} color={color.text} />
          <View style={styles.signalText}>
            <Text style={[styles.signalTitle, { color: color.text }]}>{t('signal.pressure.title')}</Text>
            <Text style={[styles.small, { color: color.textMuted }]}>{t('signal.pressure.reason', { hpa: 9 })}</Text>
          </View>
        </View>
      </View>
      <Text style={[styles.small, { color: color.textMuted }]}>{t('onb.loc.why')}</Text>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  example: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  signal: { flexDirection: 'row', gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  signalText: { flex: 1, gap: 2 },
  signalTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
});
