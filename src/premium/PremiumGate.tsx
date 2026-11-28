import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { usePremium } from './usePremium';

/** The children for a premium user, the invitation for everyone else (nothing while the first answer is out). */
export function PremiumGate({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { premium, loading } = usePremium();
  const { t } = useI18n();
  const { color } = useTheme();

  if (premium) return <>{children}</>;
  // No invitation flash for a premium user whose first answer is still out.
  if (loading) return <></>;

  return (
    <View accessibilityRole="summary" style={[styles.card, { borderColor: color.border, backgroundColor: color.surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('premium.title')}
      </Text>
      <Text style={[styles.body, { color: color.textMuted }]}>{t('premium.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[1], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 22 },
});
