// The chat, newest at the bottom: notes from Nimbo in Literata, the user's words in a bubble on the right. A new item
// rises in while the others stay put, and the typing line waits 300 ms before it shows at all.
import { memo, useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItem } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import type { Dose } from '../cabinet/doseStore';
import type { Medication } from '../cabinet/medicationStore';
import type { Episode } from '../episodes/episodeStore';
import { dayTitle } from '../history/dateLabels';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { formatClock } from '../i18n/format';
import { localDate } from '../lib/localDate';
import { easingFor, entrance, useMotion } from '../ui/motion';
import { TextLink } from '../ui/TextLink';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import type { ChatMessage } from './chatStore';
import type { Draft, Evidence, ReplacedReason } from './contract';
import { DraftCard } from './DraftCard';
import { EvidenceChips } from './EvidenceChips';
import { safeFacts } from './safeFacts';

/** How long a reply may take before the typing line mounts, so a quick reply never flickers it in and out. */
export const TYPING_DELAY_MS = 300;

const MEDICATION_REASONS: ReadonlySet<ReplacedReason> = new Set(['dose_advice', 'medication_change', 'overuse_override']);

const OTHER_TEMPLATE: Record<Exclude<ReplacedReason, 'dose_advice' | 'medication_change' | 'overuse_override'>, MessageKey> = {
  diagnosis: 'companion.safe.diagnosis',
  ungrounded_number: 'companion.safe.numbers',
  prediction: 'companion.safe.numbers',
  red_flag_dismissal: 'companion.safe.urgent',
  refusal: 'companion.refused',
};

interface Records {
  episodes: readonly Episode[];
  doses: readonly Dose[];
  medications: readonly Medication[];
  now: Date;
}

interface Handlers {
  /** Over the quota a retry could only be refused again. */
  retryDisabled: boolean;
  onRetry: (messageId: number) => void;
  onConfirm: (messageId: number, ref: string) => 'ok' | 'invalid';
  onEdit: (messageId: number, draft: Draft) => void;
  onEvidence: (evidence: Evidence) => void;
}

type Item = { kind: 'day'; key: string; label: string } | { kind: 'message'; key: string; message: ChatMessage };

/** The safe template the guard's reason asks for; the reply itself never reached the phone. */
export function ReplacedReply({ message, records }: { message: ChatMessage; records: Records }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const reason = message.payload?.replaced ?? 'refusal';
  if (MEDICATION_REASONS.has(reason)) {
    const facts = safeFacts(records.doses, records.medications, new Date(message.createdAt));
    return (
      <>
        <Text style={[styles.note, { color: color.text }]}>{t('companion.safe.dose')}</Text>
        {facts === null ? null : (
          <Text style={[styles.body, { color: color.text }]}>
            {t('companion.safe.facts', { med: facts.med, time: formatClock(facts.time, locale), hours: facts.hours })}
          </Text>
        )}
        <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.safe.notice')}</Text>
      </>
    );
  }
  const key = OTHER_TEMPLATE[reason as keyof typeof OTHER_TEMPLATE];
  return (
    <>
      <Text style={[styles.note, { color: color.text }]}>{t(key)}</Text>
      <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.safe.notice.general')}</Text>
    </>
  );
}

interface MessageItemProps extends Handlers {
  message: ChatMessage;
  fresh: boolean;
  records: Records;
}

const MessageItem = memo(function MessageItem({ message, fresh, records, retryDisabled, onRetry, onConfirm, onEdit, onEvidence }: MessageItemProps): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const motion = useMotion();
  const entering = fresh ? entrance(motion, motion.level === 'full' ? 8 : 4) : undefined;
  const rise = entering === undefined ? {} : { entering };

  if (message.role === 'user') {
    return (
      <Animated.View {...rise} style={styles.userBlock}>
        <View style={[styles.bubble, { backgroundColor: tones.opaquePill }]}>
          <Text style={[styles.body, { color: color.text }]}>{message.text}</Text>
        </View>
        {message.status === 'unsent' ? (
          <View style={styles.unsent}>
            <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.unsent')}</Text>
            <TextLink
              label={t('common.retry')}
              disabled={retryDisabled}
              onPress={() => {
                onRetry(message.id);
              }}
            />
          </View>
        ) : message.status === 'noted' ? (
          <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.in_notes')}</Text>
        ) : (
          <Text style={[styles.caption, { color: color.textMuted }]}>{formatClock(new Date(message.createdAt), locale)}</Text>
        )}
      </Animated.View>
    );
  }

  // NOTE: the debrief's closing line arrives with the debrief itself; until then nothing writes `debrief_done`.
  if (message.template === 'debrief_done') return null;
  const payload = message.payload;
  return (
    <Animated.View {...rise} style={styles.agentBlock}>
      <Text style={[styles.caption, { color: color.textMuted }]}>{t('tabs.companion')}</Text>
      {message.template === 'redflag_after' ? (
        <Text style={[styles.note, { color: color.text }]}>{t('companion.redflag.after')}</Text>
      ) : message.status === 'replaced' ? (
        <ReplacedReply message={message} records={records} />
      ) : (
        <Text style={[styles.note, { color: color.text }]}>{message.text}</Text>
      )}
      {/* A replaced reply keeps its drafts: the guard replaced the words, not the record the user asked to log. */}
      {payload === null ? null : (
        <>
          <EvidenceChips evidence={payload.evidence} onOpen={onEvidence} />
          {payload.drafts.map((draft) => (
            <DraftCard
              key={draft.ref}
              messageId={message.id}
              draft={draft}
              confirmed={Object.hasOwn(payload.confirmed, draft.ref)}
              fresh={fresh}
              episodes={records.episodes}
              medications={records.medications}
              now={records.now}
              onConfirm={onConfirm}
              onEdit={onEdit}
            />
          ))}
          {payload.guard === 'degraded' ? <Text style={[styles.caption, { color: color.textMuted }]}>{t('companion.footer.degraded')}</Text> : null}
        </>
      )}
    </Animated.View>
  );
});

/**
 * "Nimbo is writing…", mounted only once a reply has taken `TYPING_DELAY_MS`; it holds still, no dots. The list
 * mounts it per request, so each request starts its own wait.
 */
function TypingLine(): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(true);
      AccessibilityInfo.announceForAccessibility(t('companion.typing'));
    }, TYPING_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [t]);

  if (!shown) return null;
  const curve = easingFor(motion.level);
  return (
    <Animated.Text
      entering={FadeIn.duration(motion.duration.base).easing(curve).reduceMotion(ReduceMotion.Never)}
      exiting={FadeOut.duration(motion.duration.fast).easing(curve).reduceMotion(ReduceMotion.Never)}
      style={[styles.typing, { color: color.textMuted }]}
    >
      {t('companion.typing')}
    </Animated.Text>
  );
}

interface MessageListProps extends Handlers {
  messages: readonly ChatMessage[];
  typing: boolean;
  records: Records;
}

export function MessageList({ messages, typing, records, retryDisabled, onRetry, onConfirm, onEdit, onEvidence }: MessageListProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  // Messages already there when the chat first showed do not animate; one that arrives later rises in.
  const [initial] = useState(() => new Set(messages.map((message) => message.id)));

  const today = localDate(records.now);
  const items: Item[] = [];
  let day = '';
  for (const message of messages) {
    const created = new Date(message.createdAt);
    const key = localDate(created);
    if (key !== day) {
      day = key;
      items.push({ kind: 'day', key: `day-${key}`, label: key === today ? t('companion.day.today') : dayTitle(created, locale) });
    }
    items.push({ kind: 'message', key: String(message.id), message });
  }
  // Inverted, so the newest sits at the bottom and the list opens there without a scroll.
  items.reverse();

  const renderItem: ListRenderItem<Item> = useCallback(
    ({ item }) =>
      item.kind === 'day' ? (
        <Text style={[styles.day, { color: color.textMuted }]}>{item.label}</Text>
      ) : (
        <MessageItem
          message={item.message}
          fresh={!initial.has(item.message.id)}
          records={records}
          retryDisabled={retryDisabled}
          onRetry={onRetry}
          onConfirm={onConfirm}
          onEdit={onEdit}
          onEvidence={onEvidence}
        />
      ),
    [color.textMuted, initial, records, retryDisabled, onRetry, onConfirm, onEdit, onEvidence],
  );

  return (
    <FlatList
      inverted
      data={items}
      keyExtractor={(item) => item.key}
      renderItem={renderItem}
      keyboardShouldPersistTaps="handled"
      {...(typing ? { ListHeaderComponent: <TypingLine /> } : {})}
      contentContainerStyle={styles.content}
    />
  );
}

const styles = StyleSheet.create({
  content: { gap: space[3], paddingHorizontal: space[3], paddingVertical: space[3] },
  day: { alignSelf: 'center', fontFamily: fonts.bodySemiBold, fontSize: type.caption, lineHeight: 18, paddingVertical: space[1] },
  userBlock: { alignItems: 'flex-end', gap: space[0] },
  bubble: { maxWidth: '85%', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.card },
  unsent: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  agentBlock: { gap: space[2] },
  note: { fontFamily: fonts.displayRegular, fontSize: type.body, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  typing: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
});
