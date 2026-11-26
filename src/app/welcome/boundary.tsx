import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { acceptTerms } from '../../profile/profileRepository';
import { Button } from '../../ui/Button';
import { CheckRow } from '../../ui/CheckRow';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const POINTS: readonly MessageKey[] = ['boundary.records', 'boundary.patterns', 'boundary.urgent', 'boundary.doctor'];

export default function Boundary(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { patchProfile } = useAuth();
  const [adult, setAdult] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const accept = async (): Promise<void> => {
    setFailed(false);
    setSaving(true);
    try {
      const result = await acceptTerms();
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // The refetched row is the answer: once it shows, the root layout's gate moves the user on.
      patchProfile({ adultConfirmedAt: result.value.adultConfirmedAt, boundaryAcceptedAt: result.value.boundaryAcceptedAt });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('boundary.title')}</Text>
      <View style={styles.points}>
        {POINTS.map((key) => (
          <Text key={key} style={[styles.body, { color: color.text }]}>
            {t(key)}
          </Text>
        ))}
      </View>
      <View>
        <CheckRow label={t('boundary.age')} checked={adult} onChange={setAdult} />
        <CheckRow label={t('boundary.notMedical')} checked={understood} onChange={setUnderstood} />
      </View>
      {failed ? <Notice tone="danger" title={t('boundary.error')} /> : null}
      <Button
        label={t('boundary.continue')}
        disabled={!adult || !understood}
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
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
