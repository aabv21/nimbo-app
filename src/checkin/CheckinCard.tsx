// Today's two-tap check-in: sleep, then stress; the second answer saves at once, on the phone first.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import type { ComponentRef, Ref } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { useOncePerFocus } from '../lib/useOncePerFocus';
import type { MessageKey } from '../i18n';
import { entrance, useMotion } from '../ui/motion';
import { fonts, controlHeight, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { Chip } from './Chip';
import { isCheckinDone, saveCheckin, useCheckin } from './checkinStore';
import type { Checkin, SleepBand } from './checkinStore';

type Stress = NonNullable<Checkin['stress']>;

export const SLEEP_BANDS: readonly SleepBand[] = ['lt5', '5_6', '6_7', '7_8', 'gt8'];
export const STRESS_LEVELS: readonly Stress[] = ['low', 'mid', 'high'];

interface CheckinCardProps {
  userId: string;
  /** The device's calendar day the check-in belongs to. */
  localDate: string;
  /** The heading, for a screen reader's focus when Today scrolls here. */
  headingRef?: Ref<ComponentRef<typeof Text>>;
}

export function CheckinCard({ userId, localDate, headingRef }: CheckinCardProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const once = useOncePerFocus();
  const checkin = useCheckin(userId, localDate);
  const [editing, setEditing] = useState(false);
  // An answer given in this visit, not saved until its partner is known.
  const [picked, setPicked] = useState<{ sleepBand: SleepBand | null; stress: Stress | null }>({ sleepBand: null, stress: null });

  const sleepBand = picked.sleepBand ?? checkin?.sleepBand ?? null;
  const stress = picked.stress ?? checkin?.stress ?? null;
  const done = isCheckinDone(checkin) && !editing;

  const answer = (next: { sleepBand: SleepBand | null; stress: Stress | null }): void => {
    if (next.sleepBand === null || next.stress === null) {
      setPicked(next);
      return;
    }
    saveCheckin(userId, localDate, { sleepBand: next.sleepBand, stress: next.stress });
    setPicked({ sleepBand: null, stress: null });
    setEditing(false);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    AccessibilityInfo.announceForAccessibility(t('common.done'));
  };

  const more = (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        once(() => {
          router.push('/checkin');
        });
      }}
      style={styles.link}
    >
      <Text style={[styles.linkLabel, { color: color.accentText }]}>{t('today.checkin.more')}</Text>
      <ChevronRight size={18} color={color.accentText} />
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <Text ref={headingRef} accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
        {t('today.checkin.title')}
      </Text>
      {done && checkin !== null && checkin.sleepBand !== null && checkin.stress !== null ? (
        <Animated.View entering={entrance(motion, 4)} style={styles.root}>
          <Text testID="today-checkin-done" style={[styles.body, { color: color.text }]}>
            {t('today.checkin.done', {
              sleep: t(`checkin.sleep.${checkin.sleepBand}`).toLocaleLowerCase(),
              stress: t(`checkin.stress.${checkin.stress}`).toLocaleLowerCase(),
            })}
          </Text>
          <View style={styles.links}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setEditing(true);
              }}
              style={styles.link}
            >
              <Text style={[styles.linkLabel, { color: color.accentText }]}>{t('common.change')}</Text>
            </Pressable>
            {more}
          </View>
        </Animated.View>
      ) : (
        <>
          <Text style={[styles.small, { color: color.textMuted }]}>{t('today.checkin.why')}</Text>
          <Question
            label={t('today.checkin.sleep_q')}
            choices={SLEEP_BANDS.map((value) => ({ value, label: t(`checkin.sleep.${value}` satisfies MessageKey) }))}
            value={sleepBand}
            onChange={(value) => {
              answer({ sleepBand: value, stress });
            }}
          />
          <Question
            label={t('today.checkin.stress_q')}
            choices={STRESS_LEVELS.map((value) => ({ value, label: t(`checkin.stress.${value}` satisfies MessageKey) }))}
            value={stress}
            onChange={(value) => {
              answer({ sleepBand, stress: value });
            }}
          />
          {more}
        </>
      )}
    </View>
  );
}

interface QuestionProps<T extends string> {
  label: string;
  choices: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}

/** One question with its answers as radio chips; shared with the sheet. */
export function Question<T extends string>({ label, choices, value, onChange }: QuestionProps<T>): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.question}>
      <Text style={[styles.strong, { color: color.text }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
        {choices.map((choice) => (
          <Chip
            key={choice.value}
            role="radio"
            label={choice.label}
            selected={choice.value === value}
            onPress={() => {
              onChange(choice.value);
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[2] },
  heading: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  question: { gap: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: controlHeight, alignSelf: 'flex-start' },
  linkLabel: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
});
