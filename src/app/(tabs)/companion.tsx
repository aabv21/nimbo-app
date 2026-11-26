import { Redirect } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { toHref } from '../../auth/routes';
import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

// The first conversation's empty state; the chat itself arrives in a later wave.
export default function Companion(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { profile } = useAuth();
  const bottomInset = useTabBarInset();

  // A deep link with the AI off lands on Today: the tab is hidden, so its screen must not show either.
  if (profile?.aiEnabled !== true) {
    return <Redirect href={toHref('/today')} />;
  }

  return (
    <Screen bottomInset={bottomInset}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('tabs.companion')}
        </Text>
        <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.sub')}</Text>
      </View>
      <View style={styles.spacer} />
      <Text style={[styles.display, { color: color.text }]}>{t('companion.empty.title')}</Text>
      <Text style={[styles.lede, { color: color.textMuted }]}>{t('companion.empty.body')}</Text>
      <View style={styles.privacy}>
        <Lock size={16} color={color.textMuted} />
        <Text style={[styles.caption, styles.privacyText, { color: color.textMuted }]}>{t('companion.privacy')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[0] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  lede: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  spacer: { flexGrow: 1 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  privacyText: { flex: 1 },
});
