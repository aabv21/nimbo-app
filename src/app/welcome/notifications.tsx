import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { askNotificationPermission } from '../../cabinet/reminders';
import { formatClock } from '../../i18n/format';
import { useI18n } from '../../i18n';
import { DockRow, OnboardingStep, SETUP_STEPS, dockStyles } from '../../onboarding/OnboardingStep';
import { useProfileChange } from '../../profile/useProfileChange';
import { registerPush } from '../../push/pushRegistration';
import { Button } from '../../ui/Button';
import { ChoiceGroup } from '../../ui/ChoiceGroup';
import { controlHeight, fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

type LockChoice = 'neutral' | 'detail';

function next(): void {
  router.push('/welcome/location');
}

/** `HH:MM[:SS]` from the profile, as the clock the user reads. */
function clockOf(time: string, locale: Parameters<typeof formatClock>[1]): string {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return formatClock(new Date(2000, 0, 1, hours, minutes), locale);
}

/** A setting shown with its value; Profile edits it, so it is not a control here. */
function InfoRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View accessible accessibilityLabel={label} accessibilityValue={{ text: value }} style={[styles.row, { borderColor: color.border }]}>
      <Text style={[styles.rowTitle, { color: color.text }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: color.textMuted }]}>{value}</Text>
    </View>
  );
}

export default function NotificationsStep(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { profile, userId } = useAuth();
  const { change, error } = useProfileChange();
  const [asking, setAsking] = useState(false);

  const allow = async (): Promise<void> => {
    setAsking(true);
    try {
      // A denial is an answer too: the step moves on either way.
      const granted = await askNotificationPermission(locale).catch(() => false);
      // The token is stored in the background; a failure is retried at the next launch.
      if (granted && userId !== null) void registerPush(userId, locale);
      next();
    } finally {
      setAsking(false);
    }
  };

  return (
    <OnboardingStep
      done={5}
      total={SETUP_STEPS}
      title={t('onb.notif.title')}
      lede={t('onb.notif.lede')}
      error={error === undefined ? undefined : t('consent.error')}
      dock={
        <DockRow>
          <Button testID="notifications-not-now" variant="secondary" label={t('common.not_now')} disabled={asking} onPress={next} style={dockStyles.half} />
          <Button
            label={t('onb.notif.allow')}
            loading={asking}
            loadingLabel={t('common.loading')}
            onPress={() => {
              void allow();
            }}
            style={dockStyles.main}
          />
        </DockRow>
      }
    >
      <Text style={[styles.transfer, { color: color.textMuted }]}>{t('onb.notif.transfer')}</Text>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
          {t('notif.lock.title')}
        </Text>
        <ChoiceGroup<LockChoice>
          layout="cards"
          label={t('notif.lock.title')}
          value={profile?.lockScreenDetail === true ? 'detail' : 'neutral'}
          onChange={(value) => {
            void change({ lockScreenDetail: value === 'detail' });
          }}
          choices={[
            { value: 'neutral', label: t('notif.lock.neutral'), sub: t('notif.lock.neutral_sub') },
            { value: 'detail', label: t('notif.lock.detail'), sub: t('notif.lock.detail_sub') },
          ]}
        />
      </View>
      {profile === null ? null : (
        <View style={[styles.rows, { borderColor: color.border }]}>
          <InfoRow
            label={t('notif.hours')}
            value={t('notif.hours.value', { start: clockOf(profile.notifyStart, locale), end: clockOf(profile.notifyEnd, locale) })}
          />
          <InfoRow label={t('notif.cap')} value={String(profile.notifyDailyCap)} />
        </View>
      )}
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  transfer: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  rows: { borderTopWidth: 1 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[1],
    minHeight: controlHeight + space[1],
    paddingVertical: space[2],
    borderBottomWidth: 1,
  },
  rowTitle: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  rowValue: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
});
