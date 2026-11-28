// A pattern still below its minimum: its title and what it needs, never a number of its own.
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import type { InsightNeed } from './index';
import { insightTitle, needLine } from './insightText';

export function NeedCard({ need }: { need: InsightNeed }): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  return (
    <View testID={`insight-need-${need.kind}`} style={[styles.section, { borderTopColor: color.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {insightTitle(need.kind, t)}
      </Text>
      <Text style={[styles.need, { color: color.text }]}>{needLine(need, tp)}</Text>
    </View>
  );
}

export const sectionStyle = StyleSheet.create({
  section: { gap: space[3], paddingTop: space[4], borderTopWidth: StyleSheet.hairlineWidth },
  title: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});

const styles = StyleSheet.create({
  ...sectionStyle,
  need: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 22 },
});
