import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { setAiConsent } from '../../profile/profileRepository';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const SECTIONS: readonly (readonly [title: MessageKey, body: MessageKey])[] = [
  ['consent.sent.title', 'consent.sent.body'],
  ['consent.never.title', 'consent.never.body'],
  ['consent.who.title', 'consent.sharing'],
];

export default function AiConsent(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { patchProfile } = useAuth();
  const [saving, setSaving] = useState<boolean | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  const answer = async (enabled: boolean): Promise<void> => {
    setFailed(false);
    setSaving(enabled);
    try {
      const result = await setAiConsent(enabled);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Only the consent fields, as in Profile; once they show, the root layout's gate opens the tabs.
      patchProfile({ aiEnabled: result.value.aiEnabled, aiConsentAnsweredAt: result.value.aiConsentAnsweredAt });
    } finally {
      setSaving(undefined);
    }
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('consent.title')}</Text>
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
      </View>
      <Text style={[styles.body, { color: color.textMuted }]}>{t('consent.optional')}</Text>
      {failed ? <Notice tone="danger" title={t('consent.error')} /> : null}
      <Button
        label={t('consent.accept')}
        disabled={saving === false}
        loading={saving === true}
        loadingLabel={t('common.saving')}
        onPress={() => {
          void answer(true);
        }}
      />
      <Button
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
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  card: { gap: space[3], padding: space[3], borderRadius: radius.card },
  section: { gap: space[0] },
  heading: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
});
