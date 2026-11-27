// "Tell me" in crisis mode: a held mic, the red-flag check first, then the companion when it can answer, or this
// attack's notes when it can't (docs/app.md#crisis-srccrisis). The panel sits under the timer; the dock is the mic's.
import * as Haptics from 'expo-haptics';
import { Check, Mic } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../auth/AuthProvider';
import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import { readMessage, updateMessage } from '../companion/chatStore';
import type { ChatMessage } from '../companion/chatStore';
import type { Draft } from '../companion/contract';
import { DraftCard } from '../companion/DraftCard';
import { DraftEditor } from '../companion/DraftEditor';
import { ReplacedReply } from '../companion/MessageList';
import { replaceDraft, useCompanion } from '../companion/useCompanion';
import { NOTES_MAX_LENGTH, readEpisode, updateEpisode, useEpisodes } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import { useRedFlagCheck } from '../redflags/useRedFlagCheck';
import { Button } from '../ui/Button';
import { entrance, useMotion } from '../ui/motion';
import { TextLink } from '../ui/TextLink';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { dictationAvailable, PROBLEM_KEY } from '../voice/dictation';
import type { DictationProblem } from '../voice/dictation';
import { HoldToTalk } from '../voice/HoldToTalk';
import { ListenButton } from '../voice/ListenButton';

/**
 * The notes with the transcript appended on a new line, cut so the whole stays within `NOTES_MAX_LENGTH` (never
 * through an emoji's surrogate pair), and whether it was cut; null when there is no room left for any of it.
 */
export function appendToNotes(notes: string | null, transcript: string): { notes: string; cut: boolean } | null {
  const before = notes ?? '';
  const separator = before === '' ? '' : '\n';
  const room = NOTES_MAX_LENGTH - before.length - separator.length;
  if (room <= 0) return null;
  let kept = transcript.slice(0, room);
  if (kept.length < transcript.length && /[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return kept === '' ? null : { notes: `${before}${separator}${kept}`, cut: kept.length < transcript.length };
}

/** What the notes path tells the user: saved whole, saved cut, no room, the attack gone, or a store refusal. */
type NoteKey = 'crisis.tell.saved_note' | 'crisis.tell.saved_cut' | 'crisis.tell.notes_full' | 'crisis.tell.gone' | 'error.generic';

type Phase =
  | { kind: 'idle' }
  | { kind: 'waiting' }
  /** `asked` is the user's message; the reply is the first assistant line after it. */
  | { kind: 'answer'; asked: number }
  | { kind: 'note'; key: NoteKey };

export interface TellMeState {
  /** The AI is on and the phone can dictate: otherwise "Tell me" is absent and "It's over" has the dock. */
  shown: boolean;
  /** The companion can answer now; otherwise a transcript goes to the notes. */
  canSend: boolean;
  phase: Phase;
  listening: boolean;
  problem: DictationProblem | null;
  reply: ChatMessage | null;
  /** The reply's first draft still waiting for Confirm; while it waits it owns the dock. */
  pending: Draft | null;
  invalid: boolean;
  editing: Draft | null;
  onHeard: (text: string) => void;
  setListening: (listening: boolean) => void;
  setProblem: (problem: DictationProblem | null) => void;
  confirm: () => void;
  edit: () => void;
  closeEditor: () => void;
  saveEdit: (draft: Draft) => void;
  /** Puts the waiting draft aside: it stays in the Companion tab, unconfirmed. */
  dismiss: () => void;
}

export function useTellMe(episodeId: string): TellMeState {
  const { userId, profile } = useAuth();
  const user = userId ?? '';
  const companion = useCompanion('crisis', { episodeId });
  const { send, confirm: confirmDraft, messages, state, dictationOver } = companion;
  const check = useRedFlagCheck();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(() => new Set());
  const [invalid, setInvalid] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [available] = useState(dictationAvailable);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const canSend = state === 'ready' && !dictationOver;

  /** `asked`: the chat message a refused send left, marked once the notes hold its words so it is never retried too. */
  const saveNote = useCallback(
    (text: string, asked: number | null = null) => {
      const episode = readEpisode(user, episodeId);
      // Deleted on another phone meanwhile: nothing to write to, and the user is told so.
      if (episode === null) {
        setPhase({ kind: 'note', key: 'crisis.tell.gone' });
        return;
      }
      const appended = appendToNotes(episode.notes, text);
      if (appended === null) {
        setPhase({ kind: 'note', key: 'crisis.tell.notes_full' });
        return;
      }
      try {
        updateEpisode(user, episodeId, { notes: appended.notes });
      } catch {
        // `appendToNotes` keeps the length in range, so this is some other refusal; it never reaches the press.
        setPhase({ kind: 'note', key: 'error.generic' });
        return;
      }
      if (asked !== null) updateMessage(user, asked, { status: 'noted' });
      setPhase({ kind: 'note', key: appended.cut ? 'crisis.tell.saved_cut' : 'crisis.tell.saved_note' });
    },
    [user, episodeId],
  );

  const onHeard = useCallback(
    (text: string) => {
      setInvalid(false);
      // Before anything else, with or without the AI: a hit opens urgent care, once, and nothing else happens.
      if (check(text, 'voice')) {
        setPhase({ kind: 'idle' });
        return;
      }
      if (!canSend) {
        saveNote(text);
        return;
      }
      setPhase({ kind: 'waiting' });
      void (async () => {
        const asked = await send(text, 'voice');
        if (!live.current) return;
        if (asked === null) {
          setPhase({ kind: 'idle' });
          return;
        }
        // Refused on the way (a quota reached today, the service down, the connection gone): the words go to the notes.
        if (readMessage(user, asked)?.status === 'unsent') saveNote(text, asked);
        else setPhase({ kind: 'answer', asked });
      })();
    },
    [check, canSend, saveNote, send, user],
  );

  const reply = phase.kind === 'answer' ? (messages.find((message) => message.id > phase.asked && message.role === 'assistant') ?? null) : null;
  const pending =
    reply?.payload?.drafts.find((draft) => !Object.hasOwn(reply.payload?.confirmed ?? {}, draft.ref) && !setAside.has(`${String(reply.id)}:${draft.ref}`)) ??
    null;

  const confirm = (): void => {
    if (reply === null || pending === null) return;
    const result = confirmDraft(reply.id, pending.ref);
    setInvalid(result === 'invalid');
    if (result === 'ok') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const dismiss = (): void => {
    if (reply === null || pending === null) return;
    setInvalid(false);
    setSetAside((current) => new Set([...current, `${String(reply.id)}:${pending.ref}`]));
  };

  return {
    shown: profile?.aiEnabled === true && available,
    canSend,
    phase,
    listening,
    problem,
    reply,
    pending,
    invalid,
    editing,
    onHeard,
    setListening,
    setProblem,
    confirm,
    edit: () => {
      setInvalid(false);
      setEditing(pending);
    },
    closeEditor: () => {
      setEditing(null);
    },
    saveEdit: (draft) => {
      if (reply !== null) replaceDraft(user, reply.id, draft);
    },
    dismiss,
  };
}

/** What the screen shows under the timer: the listening line, a dictation problem, the reply and its draft, or a note. */
export function TellMePanel({ tell, userId }: { tell: TellMeState; userId: string }): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const episodes = useEpisodes(userId);
  const doses = useDoses(userId);
  const medications = useMedications(userId, { includeArchived: true });
  const [now] = useState(() => new Date());
  if (!tell.shown) return null;

  let body: ReactNode = null;
  if (tell.listening) {
    body = (
      <View accessibilityLiveRegion="polite" style={styles.block}>
        <View style={styles.inline}>
          <Mic size={20} color={color.text} />
          <Text style={[styles.strong, { color: color.text }]}>{t('crisis.listening')}</Text>
        </View>
        {/* "Nothing is saved until you confirm" holds only on the companion's path; the notes path saves at once. */}
        <Text style={[styles.small, { color: color.textMuted }]}>
          {t(tell.canSend ? 'crisis.listening.release' : 'crisis.listening.release_notes')}
        </Text>
      </View>
    );
  } else if (tell.problem !== null) {
    body = <Line role="alert" text={t(PROBLEM_KEY[tell.problem])} />;
  } else if (tell.phase.kind === 'waiting') {
    body = <Line text={t('companion.typing')} muted />;
  } else if (tell.phase.kind === 'note') {
    body = <Line role="alert" text={t(tell.phase.key)} />;
  } else if (tell.reply !== null) {
    const reply = tell.reply;
    const spoken = reply.template === 'redflag_after' ? t('companion.redflag.after') : reply.status === 'replaced' ? null : reply.text;
    const records = { episodes, doses, medications, now };
    body = (
      <View style={styles.block}>
        <View style={[styles.agent, { borderColor: color.border, backgroundColor: color.surface }]}>
          <View style={styles.agentHead}>
            <Text style={[styles.caption, { color: color.textMuted }]}>{t('tabs.companion')}</Text>
            {spoken === null || spoken === '' ? null : <ListenButton text={spoken} size="crisis" />}
          </View>
          {reply.status === 'replaced' ? <ReplacedReply message={reply} records={records} /> : <Text style={[styles.body, { color: color.text }]}>{spoken}</Text>}
          {reply.payload?.guard === 'degraded' ? <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.footer.degraded')}</Text> : null}
        </View>
        {tell.pending === null ? null : (
          <>
            <DraftCard
              docked
              messageId={reply.id}
              draft={tell.pending}
              confirmed={false}
              fresh
              episodes={episodes}
              medications={medications}
              now={now}
              onConfirm={() => 'ok'}
              onEdit={() => undefined}
            />
            {tell.invalid ? <Line role="alert" text={t('draft.error')} danger /> : null}
            <TextLink size="crisis" label={t('common.not_now')} onPress={tell.dismiss} />
          </>
        )}
      </View>
    );
  }

  return (
    <>
      {body === null ? null : (
        <Animated.View entering={entrance(motion, 4)} style={styles.panel}>
          {body}
        </Animated.View>
      )}
      {tell.editing === null ? null : <DraftEditor draft={tell.editing} onSave={tell.saveEdit} onClosed={tell.closeEditor} />}
    </>
  );
}

function Line({ text, role, muted = false, danger = false }: { text: string; role?: 'alert'; muted?: boolean; danger?: boolean }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Text {...(role === undefined ? {} : { accessibilityRole: role })} style={[styles.body, { color: danger ? color.danger : muted ? color.textMuted : color.text }]}>
      {text}
    </Text>
  );
}

/** The dock: Edit and Confirm while a draft waits; otherwise "Tell me" (when the AI is on) beside `over`. */
export function TellMeDock({ tell, over }: { tell: TellMeState; over: ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  if (tell.pending !== null) {
    return (
      <View style={styles.dockRow}>
        <Button variant="secondary" size="crisis" label={t('common.edit')} onPress={tell.edit} />
        <Button size="crisis" icon={Check} label={t('common.confirm')} style={styles.grow} onPress={tell.confirm} />
      </View>
    );
  }
  return (
    <View style={styles.dockRow}>
      {tell.shown ? (
        <View style={styles.grow}>
          <HoldToTalk
            label={t('crisis.tell')}
            hint={t('crisis.tell.hint')}
            size="crisis"
            disabled={tell.phase.kind === 'waiting'}
            onHeard={tell.onHeard}
            onListening={tell.setListening}
            onProblem={tell.setProblem}
          />
        </View>
      ) : null}
      {/* Out of the way while the finger is held down, so a slide can't end the attack. */}
      {tell.listening ? null : <View style={tell.shown ? null : styles.grow}>{over}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: space[2] },
  block: { gap: space[2] },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  agent: { gap: space[1], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  agentHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  dockRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space[2] },
  grow: { flex: 1 },
});
