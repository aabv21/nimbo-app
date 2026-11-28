// The Companion tab: the chat kept on this phone, evidence behind each number, and drafts the user confirms.
// The tab exists only while the AI is on (the tab list in this folder's layout); `debrief=<id>` asks about that attack.
// While the AI consent awaits a newer answer, the tab offers that screen instead of the chat (`aiActive`).
import { router, useLocalSearchParams } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { needsAiReconsent } from '../../account/consent';
import { useAuth } from '../../auth/AuthProvider';
import { useDoses } from '../../cabinet/doseStore';
import { useMedications } from '../../cabinet/medicationStore';
import { EmptyState, StateNotice } from '../../companion/CompanionStates';
import { Composer } from '../../companion/Composer';
import type { Draft, Evidence } from '../../companion/contract';
import { DebriefCard } from '../../companion/DebriefCard';
import { debriefDue } from '../../companion/debrief';
import { readDebriefsDone } from '../../companion/debriefDone';
import { DraftEditor } from '../../companion/DraftEditor';
import { EvidenceSheet } from '../../companion/EvidenceSheet';
import { MessageList } from '../../companion/MessageList';
import { companionDay, overQuotaToday, replaceDraft, useCompanion } from '../../companion/useCompanion';
import { useMinuteClock } from '../../crisis/useMinuteClock';
import { startEpisode, useEpisodes, useOpenEpisode } from '../../episodes/episodeStore';
import type { Episode } from '../../episodes/episodeStore';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { deviceTimeZone, localDate } from '../../lib/localDate';
import { useOncePerFocus } from '../../lib/useOncePerFocus';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

export default function Companion(): React.JSX.Element | null {
  const { userId, profile } = useAuth();
  // The tabs mount only for a signed-in user; this keeps the types honest.
  if (userId === null) return null;
  // Nothing reaches the AI until the newer text is answered: the chat does not mount.
  if (profile !== null && needsAiReconsent(profile)) return <ReconsentPrompt />;
  return <CompanionScreen userId={userId} />;
}

function ReconsentPrompt(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tabInset = useTabBarInset();
  return (
    <Screen bottomInset={tabInset}>
      <Text accessibilityRole="header" style={[styles.reconsentTitle, { color: color.text }]}>
        {t('consent.title')}
      </Text>
      <Notice tone="info" title={t('consent.updated')} />
      <Button
        testID="companion-reconsent"
        label={t('companion.reconsent.open')}
        onPress={() => {
          router.push('/ai-consent');
        }}
      />
    </Screen>
  );
}

function CompanionScreen({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const tabInset = useTabBarInset();
  const once = useOncePerFocus();
  const now = useMinuteClock();
  const day = localDate(now);
  const episodes = useEpisodes(userId);
  // The debrief whose saved confirmation is still showing, kept while its attack is no longer due.
  const [holding, setHolding] = useState<Episode | null>(null);
  // Re-read when the attacks change: a debrief marks its attack done in the same press that stamps it.
  const skipped = useMemo(() => {
    const done = readDebriefsDone(userId);
    return new Set(episodes.filter((episode) => done.has(episode.id)).map((episode) => episode.id));
  }, [episodes, userId]);
  // Today's debrief row opens the tab with the attack's id, never its words.
  const params = useLocalSearchParams<{ debrief?: string }>();
  const requested = typeof params.debrief === 'string' ? params.debrief : null;
  const due = useMemo(() => debriefDue(episodes, now, deviceTimeZone(), skipped, requested), [episodes, now, skipped, requested]);
  const debrief = holding ?? due;
  // Only while the card is on its questions are typed words about that attack; its saved confirmation is not a question.
  const asking = holding === null ? due : null;
  const companion = useCompanion(asking === null ? 'chat' : 'debrief', asking === null ? {} : { episodeId: asking.id });
  const { send, retry, confirm } = companion;
  const open = useOpenEpisode(userId);
  const doses = useDoses(userId);
  // Archived ones too: an old dose or draft still names its medication.
  const medications = useMedications(userId, { includeArchived: true });
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [editing, setEditing] = useState<{ messageId: number; draft: Draft } | null>(null);

  // The list only needs the day (today and yesterday labels), so it re-renders at midnight, not every minute.
  const records = useMemo(() => ({ episodes, doses, medications, now: new Date(`${day}T12:00:00`) }), [episodes, doses, medications, day]);

  const sendText = useCallback(
    (text: string) => {
      void send(text, 'text');
    },
    [send],
  );
  const sendComposed = useCallback(
    (text: string, input: 'text' | 'voice') => {
      void send(text, input);
    },
    [send],
  );
  const onRetry = useCallback(
    (messageId: number) => {
      void retry(messageId);
    },
    [retry],
  );
  const onEdit = useCallback((messageId: number, draft: Draft) => {
    setEditing({ messageId, draft });
  }, []);

  const { state } = companion;
  const placeholder: MessageKey = state === 'unavailable' ? 'companion.input.down' : state === 'over_quota' ? 'companion.input.quota' : 'companion.input.ph';

  return (
    <View style={[styles.root, { backgroundColor: color.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.root}>
        <View style={[styles.head, { paddingTop: insets.top + space[2], paddingLeft: insets.left + space[3], paddingRight: insets.right + space[2] }]}>
          <View style={styles.headText}>
            <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
              {t('tabs.companion')}
            </Text>
            <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.sub')}</Text>
          </View>
          {/* An attack can start mid-conversation: the same start (or return) as Today's, one tap away. */}
          <Button
            variant="secondary"
            icon={Plus}
            label={t('today.start.short')}
            accessibilityLabel={t(open === null ? 'today.start' : 'today.resume')}
            onPress={() => {
              once(() => {
                // Written before the push, so crisis mode opens on a saved attack even if the app dies right after.
                router.push({ pathname: '/crisis', params: { id: open === null ? startEpisode(userId) : open.id } });
              });
            }}
          />
        </View>
        <View style={styles.root}>
          {companion.messages.length === 0 && debrief === null ? (
            <View style={[styles.emptyFrame, { paddingLeft: insets.left + space[3], paddingRight: insets.right + space[3] }]}>
              <EmptyState disabled={state !== 'ready' || companion.typing} onSuggest={sendText} />
            </View>
          ) : (
            <MessageList
              messages={companion.messages}
              typing={companion.typing}
              latest={
                debrief === null ? undefined : (
                  <DebriefCard
                    key={debrief.id}
                    userId={userId}
                    episode={debrief}
                    now={now}
                    onSaved={() => {
                      setHolding(debrief);
                    }}
                    onClosed={() => {
                      setHolding(null);
                    }}
                  />
                )
              }
              records={records}
              retryDisabled={state === 'over_quota'}
              onRetry={onRetry}
              onConfirm={confirm}
              onEdit={onEdit}
              onEvidence={setEvidence}
            />
          )}
        </View>
        <View style={[styles.dock, { paddingBottom: tabInset, paddingLeft: insets.left + space[3], paddingRight: insets.right + space[3] }]}>
          <StateNotice
            state={state}
            limit={overQuotaToday(userId, companionDay(), 'companion')}
            onLogDose={() => {
              once(() => {
                router.push('/cabinet');
              });
            }}
            onCheckin={() => {
              once(() => {
                router.push('/checkin');
              });
            }}
          />
          <Composer
            disabled={state !== 'ready'}
            placeholder={placeholder}
            busy={companion.typing}
            dictationOver={companion.dictationOver}
            onSend={sendComposed}
          />
        </View>
      </KeyboardAvoidingView>
      {evidence === null ? null : (
        <EvidenceSheet
          evidence={evidence}
          episodes={episodes}
          doses={doses}
          medications={medications}
          now={now}
          onOpenEpisode={(id) => {
            once(() => {
              // Dropped at once rather than animated out: a modal would sit over the attack's screen.
              setEvidence(null);
              router.push({ pathname: '/episode/[id]', params: { id } });
            });
          }}
          onClosed={() => {
            setEvidence(null);
          }}
        />
      )}
      {editing === null ? null : (
        <DraftEditor
          draft={editing.draft}
          onSave={(draft) => {
            replaceDraft(userId, editing.messageId, draft);
          }}
          onClosed={() => {
            setEditing(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  reconsentTitle: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingBottom: space[2] },
  headText: { flex: 1, gap: space[0] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  emptyFrame: { flex: 1, paddingBottom: space[3] },
  dock: { gap: space[2], paddingTop: space[2] },
});
