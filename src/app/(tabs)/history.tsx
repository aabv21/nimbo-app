import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

// The first-day state; the calendar, list and patterns arrive with the attack records.
export default function History(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const bottomInset = useTabBarInset();

  return (
    <Screen bottomInset={bottomInset}>
      <Text accessibilityRole="header" style={[styles.display, { color: color.text }]}>
        {t('history.title')}
      </Text>
      <View style={styles.stack}>
        <Text style={[styles.title, { color: color.text }]}>{t('history.empty.title')}</Text>
        <Text style={[styles.body, { color: color.text }]}>{t('history.empty.body')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  stack: { gap: space[3] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
