import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

// The first-day state: each section says what will fill it. Logging and crisis mode arrive in later waves.
export default function Today(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { profile } = useAuth();
  const bottomInset = useTabBarInset();
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    [locale],
  );

  return (
    <Screen bottomInset={bottomInset}>
      <View style={styles.head}>
        <Text style={[styles.small, { color: color.textMuted }]}>{date}</Text>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('today.status.first')}
        </Text>
        <Text style={[styles.small, { color: color.textMuted }]}>{t('today.status.first_sub')}</Text>
      </View>

      {profile?.aiEnabled === false ? (
        <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>{t('today.summary.ai_off')}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
          {t('today.signals.title')}
        </Text>
        <Text style={[styles.small, { color: color.textMuted }]}>{t('today.signals.empty')}</Text>
      </View>

      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
          {t('today.med.title')}
        </Text>
        <Text style={[styles.small, { color: color.textMuted }]}>{t('today.med.empty')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[1] },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  card: { padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
