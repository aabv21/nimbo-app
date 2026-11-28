// The full check-in: sleep, its quality and stress, then optional facts about the day. Only what changed is saved.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../auth/AuthProvider';
import { Question, SLEEP_BANDS, STRESS_LEVELS } from '../checkin/CheckinCard';
import { Chip } from '../checkin/Chip';
import { saveCheckin, useCheckin } from '../checkin/checkinStore';
import type { Checkin, CheckinFields } from '../checkin/checkinStore';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { localDate } from '../lib/localDate';
import { alpha } from '../ui/color';
import { Button } from '../ui/Button';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { useSheetMotion } from '../ui/useSheetMotion';

const SAVED_HOLD_MS = 1000;

type Facts = Pick<Checkin, 'lowWater' | 'extraCaffeine' | 'alcohol' | 'skippedMeal' | 'screenHeavy' | 'periodStarted'>;

const FACTS: readonly { field: keyof Facts; label: MessageKey }[] = [
  { field: 'lowWater', label: 'checkin.water' },
  { field: 'extraCaffeine', label: 'checkin.caffeine' },
  { field: 'alcohol', label: 'checkin.alcohol' },
  { field: 'skippedMeal', label: 'checkin.skipped_meal' },
  { field: 'screenHeavy', label: 'checkin.screens' },
];

const QUALITIES = ['bad', 'ok', 'good'] as const;

type Form = Omit<Checkin, 'localDate' | 'dirty'>;

function formOf(checkin: Checkin | null): Form {
  return {
    sleepBand: checkin?.sleepBand ?? null,
    sleepQuality: checkin?.sleepQuality ?? null,
    stress: checkin?.stress ?? null,
    lowWater: checkin?.lowWater ?? false,
    extraCaffeine: checkin?.extraCaffeine ?? false,
    alcohol: checkin?.alcohol ?? false,
    skippedMeal: checkin?.skippedMeal ?? false,
    screenHeavy: checkin?.screenHeavy ?? false,
    periodStarted: checkin?.periodStarted ?? false,
  };
}

/** The keys whose value differs from `before`; the rest are left out so a save never overwrites a newer answer. */
function changes(before: Form, after: Form): CheckinFields {
  const changed = (Object.keys(after) as (keyof Form)[]).filter((key) => after[key] !== before[key]);
  return Object.fromEntries(changed.map((key) => [key, after[key]]));
}

const noop = (): void => undefined;

function goBack(): void {
  router.back();
}

function Sheet({ userId, day, trackPeriod }: { userId: string; day: string; trackPeriod: boolean }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const saved = useCheckin(userId, day);
  // The day as it was when the sheet opened: what "changed" is measured against.
  const [before] = useState(() => formOf(saved));
  const [form, setForm] = useState<Form>(before);
  const [done, setDone] = useState(false);
  const insets = useSafeAreaInsets();
  const { scrimStyle, sheetStyle, close } = useSheetMotion(goBack);

  // The latest `close`, so a re-render during the hold does not restart the timer.
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  });
  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => {
      latestClose.current();
    }, SAVED_HOLD_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [done]);

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = (): void => {
    const diff = changes(before, form);
    if (Object.keys(diff).length === 0) {
      close();
      return;
    }
    saveCheckin(userId, day, diff);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(true);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }, scrimStyle]}>
        {/* Tapping outside the sheet closes it; this is also the screen-reader and keyboard way out. */}
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        accessibilityViewIsModal
        style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.border }, sheetStyle]}
      >
        <View style={[styles.grip, { backgroundColor: color.border }]} />
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space[4]) }]}
        >
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
            {t('checkin.title')}
          </Text>
          {/* The scrim is hidden from screen readers by the modal sheet, so the way out is repeated here. */}
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={styles.closeButton}>
            <X size={24} color={color.textMuted} />
          </Pressable>
        </View>

      <Question
        label={t('today.checkin.sleep_q')}
        choices={SLEEP_BANDS.map((value) => ({ value, label: t(`checkin.sleep.${value}`) }))}
        value={form.sleepBand}
        onChange={(value) => { set('sleepBand', value); }}
      />
      <Question
        label={t('checkin.quality')}
        choices={QUALITIES.map((value) => ({ value, label: t(`checkin.quality.${value}`) }))}
        value={form.sleepQuality}
        onChange={(value) => { set('sleepQuality', value); }}
      />
      <Question
        label={t('today.checkin.stress_q')}
        choices={STRESS_LEVELS.map((value) => ({ value, label: t(`checkin.stress.${value}`) }))}
        value={form.stress}
        onChange={(value) => { set('stress', value); }}
      />

      <View style={styles.group}>
        <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
          {t('checkin.optional')}
        </Text>
        <View style={styles.chips}>
          {FACTS.map(({ field, label }) => (
            <Chip key={field} role="checkbox" label={t(label)} selected={form[field]} onPress={() => { set(field, !form[field]); }} />
          ))}
          {trackPeriod ? (
            <Chip role="checkbox" label={t('checkin.period')} selected={form.periodStarted} onPress={() => { set('periodStarted', !form.periodStarted); }} />
          ) : null}
        </View>
        {trackPeriod ? <Text style={[styles.caption, { color: color.textMuted }]}>{t('checkin.period.note')}</Text> : null}
      </View>

      <Button
        swap
        label={done ? t('common.done') : t('common.save')}
        {...(done ? { icon: Check } : {})}
        onPress={done ? noop : save}
      />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

export default function CheckinSheet(): React.JSX.Element | null {
  const { userId, profile } = useAuth();
  // Fixed for the visit, so a sheet left open past midnight still saves the day it was opened for.
  const [day] = useState(() => localDate());
  if (userId === null) return null;
  return <Sheet userId={userId} day={day} trackPeriod={profile?.trackPeriod === true} />;
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '90%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: space[1] },
  content: { gap: space[4], padding: space[4] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  group: { gap: space[2] },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
});
