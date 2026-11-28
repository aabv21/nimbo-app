// "What I know about you": the companion's notes about the user, each one deletable. Read online, shown from the
// cache offline with deletes off. The flow: docs/app.md, "Agent notes".
import { router } from 'expo-router';
import { Lock, Trash2 } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import type { AgentNote } from '../memory/agentNotesRepository';
import { useAgentNotes } from '../memory/useAgentNotes';
import { BackButton } from '../ui/BackButton';
import { Notice } from '../ui/Notice';
import { Screen } from '../ui/Screen';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';

function DeleteButton({ note, disabled, onPress }: { note: AgentNote; disabled: boolean; onPress: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('memory.delete')}
        // The label is the same on every row; the hint says which note it deletes.
        accessibilityHint={note.text}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.delete}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Trash2 size={22} color={disabled ? color.textMuted : color.text} />
      </Pressable>
    </Animated.View>
  );
}

export default function Memory(): React.JSX.Element | null {
  const { userId } = useAuth();
  // Registered only for a signed-in account; this keeps the types honest. Keyed so a switch never shows the last list.
  if (userId === null) return null;
  return <MemoryList key={userId} userId={userId} />;
}

function MemoryList({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { notes, live, readError, deleteFailed, forget } = useAgentNotes(userId);

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton
          testID="memory-back"
          label={t('common.back')}
          onPress={() => {
            router.back();
          }}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('profile.memory')}
        </Text>
      </View>

      {readError === undefined ? null : (
        <Notice tone="warning" announce={false} title={t(readError === 'network' ? 'error.network' : 'error.generic')} />
      )}
      {deleteFailed ? <Notice tone="danger" title={t('memory.delete.error')} /> : null}

      {notes === null ? (
        readError === undefined ? (
          <Text accessibilityRole="progressbar" style={[styles.body, { color: color.textMuted }]}>
            {t('common.loading')}
          </Text>
        ) : null
      ) : notes.length === 0 ? (
        <Text style={[styles.body, { color: color.text }]}>{t('memory.empty')}</Text>
      ) : (
        <>
          <Text style={[styles.body, { color: color.text }]}>{t('memory.lede')}</Text>
          <View style={[styles.rows, { borderColor: color.border }]}>
            {notes.map((note) => (
              <View key={note.id} testID={`memory-note-${note.id}`} style={[styles.row, { borderColor: color.border }]}>
                <Text style={[styles.body, styles.noteText, { color: color.text }]}>{note.text}</Text>
                <DeleteButton
                  note={note}
                  disabled={!live}
                  onPress={() => {
                    forget(note);
                  }}
                />
              </View>
            ))}
          </View>
        </>
      )}

      <View style={styles.only}>
        <Lock size={16} color={color.textMuted} />
        <Text style={[styles.caption, styles.grow, { color: color.textMuted }]}>{t('memory.only')}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  rows: { borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight + space[2], paddingVertical: space[1], borderBottomWidth: 1 },
  noteText: { flex: 1 },
  delete: { minWidth: controlHeight, minHeight: controlHeight, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control, overflow: 'hidden' },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  only: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  grow: { flex: 1 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
});
