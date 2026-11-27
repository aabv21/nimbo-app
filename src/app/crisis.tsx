// Crisis mode: a Dim, kept-awake layer over the app for logging an attack with taps, saved on the phone first.
// Every section is optional; closing it, by Hide or after "It's over", fades out rather than cutting to bright.
import { useKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ChevronDown, ChevronRight, CircleCheck, HardDrive, MapPin, Plus } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useAuth } from '../auth/AuthProvider';
import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import { packs } from '../condition';
import { DoseButton } from '../crisis/DoseButton';
import { EndedView, EndSheet, minutesBetween } from '../crisis/EndAttack';
import { HeadMap } from '../crisis/HeadMap';
import { IntensityScale } from '../crisis/IntensityScale';
import { TellMeDock, TellMePanel, useTellMe } from '../crisis/TellMe';
import { useMinuteClock } from '../crisis/useMinuteClock';
import { WhatHelped } from '../crisis/WhatHelped';
import { endEpisode, updateEpisode, useEpisode } from '../episodes/episodeStore';
import { formatClock, formatDuration } from '../i18n/format';
import { isMessageKey, useI18n } from '../i18n';
import { deviceTimeZone } from '../lib/localDate';
import { BackButton } from '../ui/BackButton';
import { Button } from '../ui/Button';
import { crossFade, easingFor, entrance, useMotion } from '../ui/motion';
import { resolveTheme } from '../ui/resolveTheme';
import { Screen } from '../ui/Screen';
import { controlHeight, crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { ThemeContext, toSystemScheme, useTheme, useThemeState, useTones } from '../ui/themeContext';

// The device's zone: the one `formatClock` shows times in, so a typed time means what the screen says.

function labelOf(t: ReturnType<typeof useI18n>['t'], catalog: 'painAreas' | 'symptoms', key: string): string {
  const messageKey = `condition.${catalog}.${key}`;
  return isMessageKey(messageKey) ? t(messageKey) : key;
}

interface ChipProps {
  label: string;
  checked: boolean;
  onPress: () => void;
}

function Chip({ label, checked, onPress }: ChipProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const Icon = checked ? Check : Plus;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: checked ? color.accent : color.border },
        checked && { backgroundColor: tones.opaquePill },
      ]}
    >
      <Icon size={18} color={checked ? color.text : color.textMuted} />
      <Text style={[styles.chipLabel, { color: checked ? color.text : color.textMuted }]}>{label}</Text>
    </Pressable>
  );
}

function CrisisMode({ forceDim }: { forceDim: (on: boolean) => void }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const fade = crossFade(motion);
  const { userId, profile } = useAuth();
  const user = userId ?? '';
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const episode = useEpisode(user, id);
  const episodeDoses = useDoses(user, { episodeId: id });
  const allMedications = useMedications(user, { includeArchived: true });
  const now = useMinuteClock();
  const scheme = useColorScheme();
  const [mapOpen, setMapOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [ended, setEnded] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const tell = useTellMe(id);
  const opacity = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  // Refs, not state: the system back can fire again before a render, and the fade's end must leave only once.
  const leavingRef = useRef(false);
  const goneRef = useRef(false);
  const goBack = useCallback((): void => {
    if (goneRef.current) return;
    goneRef.current = true;
    // Opened from a notification or a deep link, there is no screen below to go back to.
    if (router.canGoBack()) router.back();
    else router.replace('/today');
  }, []);

  // Brightness comes back slowly when the screen below is Day: the one exit slower than its entrance.
  const belowIsDay = resolveTheme(profile?.theme ?? 'system', toSystemScheme(scheme), false) === 'day';
  const close = (): void => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    // The app below turns back while this layer, Dim on its own, fades over it.
    forceDim(false);
    opacity.set(
      withTiming(
        0,
        { duration: belowIsDay ? motion.duration.slow : motion.duration.base, easing: easingFor(motion.level), reduceMotion: ReduceMotion.Never },
        (finished) => {
          'worklet';
          if (finished === true) scheduleOnRN(goBack);
        },
      ),
    );
  };
  // Android's back runs the same fade as Hide; a sub-view (the head map, the end question) closes first.
  const onBack = useRef(close);
  useEffect(() => {
    onBack.current = () => {
      if (mapOpen) setMapOpen(false);
      else if (asking) setAsking(false);
      else if (tell.pending !== null) tell.dismiss();
      else close();
    };
  });
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack.current();
      return true;
    });
    return () => {
      subscription.remove();
    };
  }, []);

  const medicationName = useCallback(
    (medicationId: string) => allMedications.find((medication) => medication.id === medicationId)?.name ?? '',
    [allMedications],
  );

  const toggleSymptom = (key: string): void => {
    if (episode === null) return;
    const chosen = new Set(episode.symptoms);
    if (chosen.has(key)) chosen.delete(key);
    else chosen.add(key);
    // Kept in the pack's order, whatever order they were tapped in.
    updateEpisode(user, id, { symptoms: packs.migraine.symptoms.map((item) => item.key).filter((item) => chosen.has(item)) });
  };
  // A press handler never throws: a time the store refuses comes back to the sheet as its inline error.
  const confirmEnd = (endedAt: Date): boolean => {
    try {
      endEpisode(user, id, endedAt);
    } catch {
      return false;
    }
    setAsking(false);
    setEnded(true);
    return true;
  };

  let content: React.JSX.Element;
  if (episode === null) {
    // Deleted on another phone, or a stale link: nothing to log against.
    // Deleted while "Tell me" was out, the panel still says the words could not be saved.
    content = (
      <View style={styles.dockOnly}>
        <TellMePanel tell={tell} userId={user} />
        <Button variant="secondary" size="crisis" label={t('common.close')} disabled={leaving} onPress={close} />
      </View>
    );
  } else if (ended || episode.endedAt !== null) {
    // An attack that already ended (a stale link) only shows what was saved.
    content = (
      <EndedView
        episode={episode}
        doses={episodeDoses}
        medicationName={medicationName}
        debrief={profile?.aiEnabled === true}
        onFill={() => {
                router.replace(`/episode/${id}/edit`);
        }}
        onClose={close}
      />
    );
  } else if (mapOpen) {
    content = (
      <>
        <View style={styles.topbar}>
          <BackButton
            label={t('common.back')}
            onPress={() => {
              setMapOpen(false);
            }}
          />
          <Text accessibilityRole="header" style={[styles.topTitle, { color: color.text }]}>
            {t('crisis.where.title')}
          </Text>
        </View>
        <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <HeadMap
            value={episode.painAreas}
            onChange={(areas) => {
              updateEpisode(user, id, { painAreas: areas });
            }}
          />
        </ScrollView>
        <View style={[styles.dock, { borderTopColor: color.border }]}>
          <Button
            size="crisis"
            label={t('common.done')}
            onPress={() => {
              setMapOpen(false);
            }}
          />
        </View>
      </>
    );
  } else {
    const startedAt = new Date(episode.startedAt);
    const acute = allMedications.filter((medication) => medication.kind === 'acute' && !medication.archived);
    const marked = episode.painAreas.map((area) => labelOf(t, 'painAreas', area)).join(', ');
    const elapsed = formatDuration(minutesBetween(startedAt, now));
    content = (
      <>
        <View style={styles.topbar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('crisis.hide.aria')}
            disabled={leaving}
            onPress={close}
            style={styles.textButton}
          >
            <ChevronDown size={24} color={color.accentText} />
            <Text style={[styles.textButtonLabel, { color: color.accentText }]}>{t('crisis.hide')}</Text>
          </Pressable>
          <View style={styles.fill} />
          {episode.dirty ? (
            <View style={styles.inline}>
              <HardDrive size={16} color={color.textMuted} />
              <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.saved_local')}</Text>
            </View>
          ) : null}
        </View>

        <ScrollView style={styles.fill} contentContainerStyle={styles.content}>
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
              {t('today.status.running')}
            </Text>
            <View style={styles.timerLine}>
              <Animated.Text key={elapsed} entering={fade.entering} exiting={fade.exiting} style={[styles.elapsed, { color: color.text }]}>
                {elapsed}
              </Animated.Text>
              <Text style={[styles.small, { color: color.textMuted }]}>{t('crisis.since', { time: formatClock(startedAt, locale) })}</Text>
            </View>
          </View>

          <TellMePanel tell={tell} userId={user} />

          {/* A waiting draft has the screen to itself until it is confirmed or put aside. */}
          {tell.pending !== null ? null : (
            <>
              <IntensityScale
                value={episode.intensity}
                onChange={(intensity) => {
                  updateEpisode(user, id, { intensity });
                }}
              />

              <View style={styles.section}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
                  {t('crisis.symptoms.title')}
                </Text>
                <View style={styles.chips}>
                  {packs.migraine.symptoms.map((item) => (
                    <Chip
                      key={item.key}
                      label={labelOf(t, 'symptoms', item.key)}
                      checked={episode.symptoms.includes(item.key)}
                      onPress={() => {
                        toggleSymptom(item.key);
                      }}
                    />
                  ))}
                </View>
                {profile?.aiEnabled === false ? <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.ai_off')}</Text> : null}
              </View>

              {acute.length === 0 ? null : (
                <View style={styles.section}>
                  <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
                    {t('crisis.doses.title')}
                  </Text>
                  {acute.map((medication) => (
                    <DoseButton key={medication.id} userId={user} episodeId={id} medication={medication} now={now} timeZone={deviceTimeZone()} />
                  ))}
                </View>
              )}

              <WhatHelped episodeId={id} />

              <View style={styles.section}>
                <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
                  {t('crisis.where.title')}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('crisis.where.open')}, ${marked === '' ? t('common.optional') : marked}`}
                  onPress={() => {
                    setMapOpen(true);
                  }}
                  style={[styles.row, { borderColor: color.border }]}
                >
                  <MapPin size={24} color={color.text} />
                  <View style={styles.fill}>
                    <Text style={[styles.rowTitle, { color: color.text }]}>{t('crisis.where.open')}</Text>
                    <Text style={[styles.small, { color: color.textMuted }]}>{marked === '' ? t('common.optional') : marked}</Text>
                  </View>
                  <ChevronRight size={24} color={color.textMuted} />
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>

        <View style={[styles.dock, { borderTopColor: color.border }]}>
          <TellMeDock
            tell={tell}
            over={
              <Button
                testID="crisis-over"
                variant="secondary"
                size="crisis"
                icon={CircleCheck}
                label={t('crisis.over')}
                disabled={leaving}
                onPress={() => {
                  setAsking(true);
                }}
              />
            }
          />
        </View>

      </>
    );
  }

  return (
    <Animated.View accessibilityViewIsModal entering={entrance(motion, 0)} style={[styles.fill, fadeStyle]}>
      <Screen scroll={false} contentStyle={styles.frame}>
        <Animated.View entering={entrance(motion, 8, 60)} style={styles.fill}>
          {content}
        </Animated.View>
      </Screen>
      {/* Over the whole layer, gutters and safe area included. */}
      {asking && episode !== null && episode.endedAt === null ? (
        <EndSheet
          startedAt={new Date(episode.startedAt)}
          timeZone={deviceTimeZone()}
          onConfirm={confirmEnd}
          onNotYet={() => {
            setAsking(false);
          }}
        />
      ) : null}
    </Animated.View>
  );
}

export default function Crisis(): React.JSX.Element {
  const outer = useThemeState();
  const { forceDim, reduceMotion } = outer;
  useKeepAwake(undefined, { suppressDeactivateWarnings: true });

  // The app under the layer goes Dim too, so nothing bright shows through while it fades in.
  useEffect(() => {
    forceDim(true);
    return () => {
      forceDim(false);
    };
  }, [forceDim]);

  // The layer stays Dim on its own even after the app below turns back as it closes.
  const dim = useMemo(() => ({ name: 'dim' as const, reduceMotion, forceDim }), [reduceMotion, forceDim]);
  return (
    <ThemeContext.Provider value={dim}>
      <CrisisMode forceDim={forceDim} />
    </ThemeContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  frame: { gap: space[2] },
  content: { flexGrow: 1, gap: space[4], paddingBottom: space[3] },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight },
  textButton: { flexDirection: 'row', alignItems: 'center', gap: space[0], minHeight: controlHeight, paddingRight: space[2] },
  textButtonLabel: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22 },
  topTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space[0] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  head: { gap: space[1] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  timerLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space[2] },
  elapsed: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: {
    minHeight: crisisControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
  },
  chipLabel: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
  row: {
    minHeight: crisisControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.card,
    borderWidth: 1,
  },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22 },
  dock: { marginHorizontal: -space[3], paddingHorizontal: space[3], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth },
  dockOnly: { flex: 1, justifyContent: 'flex-end', gap: space[3] },
});
