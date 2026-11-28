// The companion's note at the top of Today, with "Reply" into the chat while the AI is on.
import { MessageCircle } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { TextLink } from '../ui/TextLink';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { noteText } from './companionNote';
import { localHourIn } from './index';
import type { NoteState } from './companionNote';

/** Before this hour in the rows' zone the note is "this morning"'s; after it, "just now"'s. */
const MORNING_UNTIL_HOUR = 12;

interface CompanionNoteCardProps {
  state: NoteState;
  now: Date;
  timeZone: string;
  /** Absent with the AI off: there is no chat to reply in. */
  onReply: (() => void) | null;
}

export function CompanionNoteCard({ state, now, timeZone, onReply }: CompanionNoteCardProps): React.JSX.Element {
  const { t, tp, locale } = useI18n();
  const { color } = useTheme();
  const { text, count } = noteText(state, { t, tp, locale, timeZone });

  return (
    <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
      <Text style={[styles.by, { color: color.textMuted }]}>{t(localHourIn(now, timeZone) < MORNING_UNTIL_HOUR ? 'today.note.by_morning' : 'today.note.by_now')}</Text>
      <Text style={[styles.text, { color: color.text }]}>{text}</Text>
      {count === null ? null : <Text style={[styles.count, { color: color.textMuted }]}>{count}</Text>}
      {onReply === null ? null : (
        <View style={styles.reply}>
          <TextLink label={t('today.note.reply')} onPress={onReply} />
          <MessageCircle size={18} color={color.accentText} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: space[3], borderRadius: radius.card, borderWidth: 1, gap: space[2] },
  by: { fontFamily: fonts.bodyBold, fontSize: type.caption, lineHeight: 18 },
  text: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 29 },
  count: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
