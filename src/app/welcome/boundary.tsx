import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { policyUrl } from '../../account/consent';
import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { acceptTerms } from '../../profile/profileRepository';
import { EmergencyCallRow } from '../../redflags/EmergencyCall';
import { Button } from '../../ui/Button';
import { CheckRow } from '../../ui/CheckRow';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { TextLink } from '../../ui/TextLink';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const POINTS: readonly MessageKey[] = ['boundary.records', 'boundary.patterns', 'boundary.urgent', 'boundary.doctor'];

export default function Boundary(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { profile, patchProfile } = useAuth();
  const [adult, setAdult] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [health, setHealth] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // A stored version means the gate sent the user back for a newer text.
  const updated = profile !== null && profile.termsVersion !== null;

  const accept = async (): Promise<void> => {
    setFailed(false);
    setSaving(true);
    try {
      const result = await acceptTerms(locale);
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // The refetched row is the answer: once it shows, the root layout's gate moves the user on.
      patchProfile({
        adultConfirmedAt: result.value.adultConfirmedAt,
        boundaryAcceptedAt: result.value.boundaryAcceptedAt,
        termsVersion: result.value.termsVersion,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('boundary.title')}</Text>
      {updated ? <Notice tone="info" announce={false} title={t('boundary.updated')} /> : null}
      {/* Until the newer terms are accepted (online) no other screen opens, urgent care included, so the call stays here. */}
      {updated ? (
        <View style={styles.emergency}>
          <Text style={[styles.body, { color: color.text }]}>{t('boundary.emergency')}</Text>
          <EmergencyCallRow testID="boundary-emergency-call" />
        </View>
      ) : null}
      <View style={styles.points}>
        {POINTS.map((key) => (
          <Text key={key} style={[styles.body, { color: color.text }]}>
            {t(key)}
          </Text>
        ))}
      </View>
      <View>
        <CheckRow testID="boundary-adult" label={t('boundary.age')} checked={adult} onChange={setAdult} />
        <CheckRow testID="boundary-not-medical" label={t('boundary.notMedical')} checked={understood} onChange={setUnderstood} />
      </View>
      {/* Health data needs its own consent, specific and set apart, not one more box under the others. */}
      <View style={[styles.health, { backgroundColor: color.surface, borderColor: color.accent }]}>
        <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
          {t('boundary.health.title')}
        </Text>
        <CheckRow testID="boundary-health" label={t('boundary.health')} checked={health} onChange={setHealth} />
      </View>
      <TextLink
        testID="boundary-terms"
        label={t('boundary.terms')}
        role="link"
        onPress={() => {
          Linking.openURL(policyUrl(locale)).catch(() => undefined);
        }}
      />
      {failed ? <Notice tone="danger" title={t('boundary.error')} /> : null}
      <Button
        testID="boundary-continue"
        label={t('boundary.continue')}
        disabled={!adult || !understood || !health}
        loading={saving}
        loadingLabel={t('common.saving')}
        onPress={() => {
          void accept();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  points: { gap: space[2] },
  emergency: { gap: space[2] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  health: { gap: space[1], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  heading: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
});
