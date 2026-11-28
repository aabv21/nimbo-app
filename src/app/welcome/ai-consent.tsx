import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { policyUrl } from '../../account/consent';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { SETUP_STEPS, StepProgress } from '../../onboarding/OnboardingStep';
import { setAiConsent } from '../../profile/profileRepository';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { TextLink } from '../../ui/TextLink';
import { controlHeight, fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const SECTIONS: readonly (readonly [title: MessageKey, body: MessageKey])[] = [
  ['consent.sent.title', 'consent.sent.body'],
  ['consent.never.title', 'consent.never.body'],
  ['consent.who.title', 'consent.sharing'],
];

export default function AiConsent(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { profile, patchProfile } = useAuth();
  const [saving, setSaving] = useState<boolean | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // Onboarded, the user came from the Companion tab's prompt (`/ai-consent`) to answer a newer text.
  const again = profile !== null && profile.onboardingCompletedAt !== null;

  const answer = async (enabled: boolean): Promise<void> => {
    setFailed(false);
    setSaving(enabled);
    try {
      const result = await setAiConsent(enabled, locale);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // No gate opened this screen for an onboarded user, so it leaves: to the chat on a yes, to Today on a no (the tab
      // is gone). First, so the patch below, which unregisters this route, never removes the screen under the user.
      if (again) router.dismissTo(result.value.aiEnabled ? '/companion' : '/today');
      // Only the consent fields, as in Profile; during onboarding the root layout's gate then moves on by itself.
      patchProfile({
        aiEnabled: result.value.aiEnabled,
        aiConsentAnsweredAt: result.value.aiConsentAnsweredAt,
        aiConsentVersion: result.value.aiConsentVersion,
      });
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <Screen>
      {/* An onboarded user is here only to answer a newer text, not to start the setup steps. */}
      <View style={styles.top}>{again ? null : <StepProgress done={1} total={SETUP_STEPS} />}</View>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('consent.title')}</Text>
      {/* A stored version means a newer text is being asked for, as on the boundary screen. */}
      {profile !== null && profile.aiConsentVersion !== null ? <Notice tone="info" announce={false} title={t('consent.updated')} /> : null}
      <Text style={[styles.body, { color: color.text }]}>{t('consent.what')}</Text>
      <View style={[styles.card, { backgroundColor: color.surface }]}>
        {SECTIONS.map(([title, body]) => (
          <View key={title} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
              {t(title)}
            </Text>
            <Text style={[styles.body, { color: color.text }]}>{t(body)}</Text>
          </View>
        ))}
        <Text style={[styles.body, { color: color.text }]}>{t('consent.transfer')}</Text>
        <TextLink
          testID="ai-consent-policy"
          label={t('consent.policy_link')}
          role="link"
          onPress={() => {
            Linking.openURL(policyUrl(locale, 'ai')).catch(() => undefined);
          }}
        />
      </View>
      <Text style={[styles.body, { color: color.textMuted }]}>{t('consent.optional')}</Text>
      {failed ? <Notice tone="danger" title={t('consent.error')} /> : null}
      <Button
        testID="ai-consent-accept"
        label={t('consent.accept')}
        disabled={saving === false}
        loading={saving === true}
        loadingLabel={t('common.saving')}
        onPress={() => {
          void answer(true);
        }}
      />
      <Button
        testID="ai-consent-decline"
        variant="secondary"
        label={t('consent.decline')}
        disabled={saving === true}
        loading={saving === false}
        loadingLabel={t('common.saving')}
        onPress={() => {
          void answer(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { minHeight: controlHeight, justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  card: { gap: space[3], padding: space[3], borderRadius: radius.card },
  section: { gap: space[0] },
  heading: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
});
