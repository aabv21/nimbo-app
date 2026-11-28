import { ChevronRight, OctagonAlert, TriangleAlert } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controlHeight, fonts, radius, space, type } from './theme';
import { useTheme, useTones } from './themeContext';

interface NoticeProps {
  /** `warning` is amber (approaching a limit); `danger` is brick (at it). Both carry an icon and words, never colour alone. */
  tone: 'warning' | 'danger';
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

export function Notice({ tone, title, body, action }: NoticeProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const danger = tone === 'danger';
  const mark = danger ? color.danger : color.warning;
  const Icon = danger ? OctagonAlert : TriangleAlert;

  return (
    <View
      // A danger notice interrupts a screen reader; a warning waits its turn.
      accessibilityRole={danger ? 'alert' : 'summary'}
      accessibilityLiveRegion={danger ? 'assertive' : 'polite'}
      style={[styles.notice, { borderColor: mark, backgroundColor: danger ? tones.noticeDanger : tones.noticeWarning }]}
    >
      <Icon size={24} color={mark} />
      <View style={styles.content}>
        <Text style={[styles.title, { color: color.text }]}>{title}</Text>
        {body === undefined ? null : <Text style={[styles.body, { color: color.text }]}>{body}</Text>}
        {action === undefined ? null : (
          <Pressable accessibilityRole="button" onPress={action.onPress} style={styles.action} hitSlop={space[0]}>
            <Text style={[styles.actionLabel, { color: color.accentText }]}>{action.label}</Text>
            <ChevronRight size={20} color={color.accentText} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    gap: space[2],
    padding: space[3],
    borderRadius: radius.card,
    borderWidth: 1,
  },
  content: { flex: 1, gap: space[0] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  action: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space[0], minHeight: controlHeight },
  actionLabel: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
