// The day-after debrief in the chat: three questions answered with chips or skipped, saved on the attack together.
// The questions are the app's own words, and every number in them comes from the attack's record.
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import { Chip } from '../checkin/Chip';
import { packs } from '../condition';
import type { Locale } from '../condition';
import { minutesBetween } from '../crisis/EndAttack';
import { saveDebrief } from '../episodes/episodeStore';
import type { Episode } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import type { I18n, MessageKey } from '../i18n';
import { formatDuration } from '../i18n/format';
import { deviceTimeZone } from '../lib/localDate';
import { Button } from '../ui/Button';
import { entrance, useMotion } from '../ui/motion';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { appendMessage } from './chatStore';
import { debriefChips, debriefGreetingKey } from './debrief';
import { markDebriefDone } from './debriefDone';
import type { DebriefChip, DebriefStep } from './debrief';

const STEPS: readonly DebriefStep[] = ['helped', 'not_helped', 'triggers'];
/** How long the saved confirmation holds before the closing line takes the card's place. */
const SAVED_HOLD_MS = 1000;

/** One step's answer: the chips picked, `none` for "Nothing", neither for a skip. */
interface Answer {
  picks: readonly DebriefChip[];
  none: boolean;
}

const dateFormats = new Map<Locale, Intl.DateTimeFormat>();

/** "November 25", "25 de noviembre": the day only, which reads right after "on", "el" and "em". */
function dayInSentence(date: Date, locale: Locale): string {
  let format = dateFormats.get(locale);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' });
    dateFormats.set(locale, format);
  }
  return format.format(date);
}

function question(step: DebriefStep, episode: Episode, now: Date, { t, locale }: Pick<I18n, 't' | 'locale'>): string {
  if (step === 'not_helped') return t('debrief.q.not_helped');
  if (step === 'triggers') return t('debrief.q.triggers');
  const start = new Date(episode.startedAt);
  const end = new Date(episode.endedAt ?? episode.startedAt);
  return t(debriefGreetingKey(episode, now, deviceTimeZone()), {
    duration: formatDuration(minutesBetween(start, end)),
    date: dayInSentence(end, locale),
  });
}

interface DebriefCardProps {
  userId: string;
  /** An attack `debriefDue` picked. */
  episode: Episode;
  now: Date;
  /** The answers are saved; the card holds its confirmation until `onClosed`. */
  onSaved: () => void;
  /** The confirmation is over and the closing line is in the chat. */
  onClosed: () => void;
}

export function DebriefCard({ userId, episode, now, onSaved, onClosed }: DebriefCardProps): React.JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const { color } = useTheme();
  const tones = useTones();
  const motion = useMotion();
  const doses = useDoses(userId, { episodeId: episode.id });
  const medications = useMedications(userId, { includeArchived: true });
  const [answers, setAnswers] = useState<readonly Answer[]>([]);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [none, setNone] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  const step = STEPS[Math.min(answers.length, STEPS.length - 1)] ?? 'helped';
  const helpedKeys = answers[0]?.picks.map((chip) => chip.key) ?? [];
  const chips = debriefChips(step, episode, doses, medications, packs.migraine, { helped: helpedKeys });
  const labelOf = (chip: DebriefChip): string => chip.label ?? (chip.labelKey === null ? '' : t(chip.labelKey as MessageKey));

  const savedRef = useRef(false);
  // The closing line goes in once, after the hold or when the card is left during it, whichever comes first.
  const closed = useRef(false);
  const latest = useRef({ onClosed });
  useEffect(() => {
    latest.current = { onClosed };
  });
  const close = useRef(() => {
    if (closed.current) return;
    closed.current = true;
    appendMessage(userId, { role: 'assistant', input: 'text', text: '', template: 'debrief_done', createdAt: Date.now(), status: 'answered', mode: 'debrief', payload: null });
    latest.current.onClosed();
  });
  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(close.current, SAVED_HOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [saved]);
  useEffect(
    () => () => {
      if (savedRef.current) close.current();
    },
    [],
  );

  const finish = (all: readonly Answer[]): boolean => {
    const [helped, notHelped, triggers] = all;
    const keysOf = (answer: Answer | undefined, kind: DebriefChip['kind']): string[] =>
      (answer?.picks ?? []).filter((chip) => chip.kind === kind).map((chip) => chip.key);
    const doseHelped: Record<string, boolean> = {};
    const mark = (answer: Answer | undefined, value: boolean): void => {
      const medicationIds = keysOf(answer, 'dose');
      for (const dose of doses) if (medicationIds.includes(dose.medicationId)) doseHelped[dose.id] = value;
    };
    mark(helped, true);
    mark(notHelped, false);
    try {
      saveDebrief(userId, episode.id, {
        helped: keysOf(helped, 'relief'),
        didNotHelp: keysOf(notHelped, 'relief'),
        triggers: keysOf(triggers, 'trigger'),
        doseHelped,
      });
    } catch {
      // A store refusal (a key or time it cannot save) rolls everything back; the last step stays, shown, to try again.
      return false;
    }
    try {
      // Belt and braces: should the server refuse the stamp, the next pull would bring the question back.
      markDebriefDone(userId, episode.id);
    } catch {
      // The answers are saved and stamped; only the backstop is missing, so the debrief still ends.
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return true;
  };

  const submit = (answer: Answer): void => {
    // The ref, not the state: a second tap before the re-render must not save twice.
    if (savedRef.current) return;
    const all = [...answers, answer];
    if (all.length === STEPS.length) {
      if (!finish(all)) {
        setFailed(true);
        return;
      }
      savedRef.current = true;
      setSaved(true);
      onSaved();
    }
    const next = STEPS[all.length];
    // A new question is read out; the first one is read with the screen.
    if (next !== undefined) AccessibilityInfo.announceForAccessibility(question(next, episode, now, i18n));
    setFailed(false);
    setAnswers(all);
    setPicked([]);
    setNone(false);
  };

  const toggle = (key: string): void => {
    setNone(false);
    setPicked((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  };

  const rise = entrance(motion, motion.level === 'full' ? 8 : 4);
  const shownSteps = saved ? STEPS.length : answers.length + 1;
  const offersNone = step !== 'triggers';

  return (
    <View style={styles.root}>
      {STEPS.slice(0, shownSteps).map((itemStep, index) => {
        const answer = answers.at(index);
        const active = answer === undefined;
        const labels = answer === undefined ? [] : answer.none ? [t('debrief.none')] : answer.picks.map(labelOf);
        return (
          <View key={itemStep} style={styles.root}>
            {/* The first question is there with the screen; each later one rises in as it is asked. */}
            <Animated.View {...(index === 0 ? {} : { entering: rise })} style={styles.agentBlock}>
              <Text style={[styles.caption, { color: color.textMuted }]}>
                {active ? t('debrief.progress', { n: index + 1, of: STEPS.length }) : t('tabs.companion')}
              </Text>
              <Text style={[styles.note, { color: color.text }]}>{question(itemStep, episode, now, i18n)}</Text>
              {active ? (
                <>
                  <View style={styles.chips}>
                    {chips.map((chip) => (
                      <Chip
                        key={chip.key}
                        role="checkbox"
                        label={labelOf(chip)}
                        selected={picked.includes(chip.key)}
                        onPress={() => {
                          toggle(chip.key);
                        }}
                      />
                    ))}
                    {offersNone ? (
                      <Chip
                        role="checkbox"
                        label={t('debrief.none')}
                        selected={none}
                        onPress={() => {
                          setPicked([]);
                          setNone((current) => !current);
                        }}
                      />
                    ) : null}
                  </View>
                  {failed ? (
                    <Text accessibilityRole="alert" style={[styles.caption, { color: color.danger }]}>
                      {t('boundary.error')}
                    </Text>
                  ) : null}
                </>
              ) : null}
            </Animated.View>
            {labels.length === 0 ? null : (
              <Animated.View entering={rise} style={styles.userBlock}>
                <View style={[styles.bubble, { backgroundColor: tones.opaquePill }]}>
                  <Text style={[styles.body, { color: color.text }]}>{labels.join(t('common.list.separator'))}</Text>
                </View>
              </Animated.View>
            )}
          </View>
        );
      })}
      <View style={styles.actions}>
        {saved ? null : (
          <Button
            testID="debrief-skip"
            variant="secondary"
            label={t('common.skip')}
            style={styles.grow}
            onPress={() => {
              submit({ picks: [], none: false });
            }}
          />
        )}
        <Button
          testID="debrief-send"
          swap
          label={saved ? t('common.done') : t('companion.send')}
          {...(saved ? { icon: Check } : {})}
          disabled={!saved && picked.length === 0 && !none}
          style={styles.grow}
          onPress={() => {
            submit({ picks: chips.filter((chip) => picked.includes(chip.key)), none });
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[3] },
  agentBlock: { gap: space[2] },
  userBlock: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', paddingHorizontal: space[3], paddingVertical: space[2], borderRadius: radius.card },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  note: { fontFamily: fonts.displayRegular, fontSize: type.body, lineHeight: 26 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
