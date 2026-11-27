// The urgent-care screen for a red-flag hit: what was found, why it matters and one call button.
// It opens over anything, the same way every time: a short fade and a warning haptic, nothing that moves.
import { getLocales } from 'expo-localization';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import type { Href } from 'expo-router';
import { Clock, OctagonAlert, Phone, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { emergencyNumber, packs } from '../condition';
import { isMessageKey, useI18n } from '../i18n';
import { clearUrgentCare, currentUrgentCare } from '../redflags/urgentCare';
import { Button } from '../ui/Button';
import { easing, motionFor } from '../ui/motion';
import { Screen } from '../ui/Screen';
import { crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';

// The phone's region, not the app language: a Spanish speaker in Brazil needs 192.
function phoneRegion(): string | null {
  return getLocales()[0].regionCode ?? null;
}

function goBack(): void {
  router.back();
}

function dial(number: string): void {
  // An empty `tel:` opens the dialer with no number; a phone with no dialer has nothing better to offer.
  Linking.openURL(`tel:${number}`).catch(() => undefined);
}

interface CallButtonProps {
  label: string;
  sub: string | null;
  disabled: boolean;
  onPress: () => void;
}

/** The screen's one filled control: danger fill, 56 pt, full width, with the region under the number. */
function CallButton({ label, sub, disabled, onPress }: CallButtonProps): React.JSX.Element {
  const { color } = useTheme();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={sub === null ? label : `${label}, ${sub}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.call, { backgroundColor: color.danger }]}
      >
        <View pointerEvents="none" style={styles.pressLayer}>
          <Animated.View style={[styles.fill, { backgroundColor: color.onAccent }, pressedStyle]} />
        </View>
        <View style={styles.callRow}>
          <Phone size={24} color={color.onAccent} />
          <Text style={[styles.callLabel, { color: color.onAccent }]}>{label}</Text>
        </View>
        {sub === null ? null : <Text style={[styles.callSub, { color: color.onAccent }]}>{sub}</Text>}
      </Pressable>
    </Animated.View>
  );
}

export default function UrgentCare(): React.JSX.Element {
  const { t } = useI18n();
  const { name, color } = useTheme();
  const tones = useTones();
  // The reduced-motion fade in every theme: no movement to calm, and urgent words never wait longer at night.
  const fade = motionFor(name, true).duration.base;
  const [request] = useState(currentUrgentCare);
  const [region] = useState(phoneRegion);
  const [leaving, setLeaving] = useState(false);
  const opacity = useSharedValue(1);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);
  // Read once above, forgotten when the screen goes; not in the initializer, which StrictMode runs twice.
  useEffect(() => clearUrgentCare, []);

  const number = emergencyNumber(region);
  const regionKey = region === null ? null : `region.${region.toLowerCase()}`;
  const regionName = regionKey !== null && isMessageKey(regionKey) ? t(regionKey) : null;
  const duration = request?.source === 'duration';
  const episodeId = request?.episodeId ?? null;
  const why = packs.migraine.redFlags
    .filter((flag) => request?.flags.includes(flag.key) === true)
    .flatMap((flag) => (isMessageKey(flag.whyKey) ? [{ key: flag.key, text: t(flag.whyKey) }] : []));

  const close = (): void => {
    setLeaving(true);
    opacity.set(
      withTiming(0, { duration: fade, easing: easing.linear, reduceMotion: ReduceMotion.Never }, (finished) => {
        'worklet';
        if (finished === true) scheduleOnRN(goBack);
      }),
    );
  };
  const fixTime = (id: string): void => {
    // NOTE: a cast until the episode editor route exists; drop it once typed routes list /episode/[id]/edit.
    router.replace(`/episode/${id}/edit` as Href);
  };

  return (
    <Animated.View
      accessibilityViewIsModal
      entering={FadeIn.duration(fade).easing(easing.linear).reduceMotion(ReduceMotion.Never)}
      style={[styles.root, fadeStyle]}
    >
      <Screen scroll={false} contentStyle={styles.frame}>
        <ScrollView style={styles.root} contentContainerStyle={styles.content}>
          <View style={styles.head}>
            <OctagonAlert size={32} color={color.danger} />
            <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
              {t('redflag.title')}
            </Text>
          </View>

          {request === null ? null : (
            <View
              accessibilityRole="alert"
              style={[styles.notice, { borderColor: color.danger, backgroundColor: tones.noticeDanger }]}
            >
              {duration ? <Clock size={24} color={color.danger} /> : <TriangleAlert size={24} color={color.danger} />}
              <View style={styles.noticeText}>
                {duration ? (
                  <Text style={[styles.strong, { color: color.text }]}>{t('redflag.long')}</Text>
                ) : (
                  <>
                    <Text style={[styles.small, { color: color.text }]}>
                      {t(request.source === 'voice' ? 'redflag.detected.voice' : 'redflag.detected.text')}
                    </Text>
                    {request.excerpt === null ? null : (
                      <Text style={[styles.strong, { color: color.text }]}>{t('redflag.excerpt', { text: request.excerpt })}</Text>
                    )}
                  </>
                )}
              </View>
            </View>
          )}

          {why.map((line) => (
            <Text key={line.key} style={[styles.body, { color: color.text }]}>
              {line.text}
            </Text>
          ))}
          <Text style={[styles.body, { color: color.text }]}>{t('redflag.company')}</Text>

          {number === null ? (
            <View style={styles.unknown}>
              <Text style={[styles.strong, { color: color.text }]}>{t('redflag.unknown')}</Text>
              <Text style={[styles.small, { color: color.textMuted }]}>{t('redflag.unknown_why')}</Text>
            </View>
          ) : (
            <Text style={[styles.caption, { color: color.textMuted }]}>{t('redflag.source')}</Text>
          )}
        </ScrollView>

        <View style={[styles.dock, { borderTopColor: color.border }]}>
          {number === null ? (
            <CallButton
              label={t('redflag.open_dialer')}
              sub={null}
              disabled={leaving}
              onPress={() => {
                dial('');
              }}
            />
          ) : (
            <CallButton
              label={t('redflag.call', { number })}
              sub={regionName === null ? null : t('redflag.call_sub', { region: regionName })}
              disabled={leaving}
              onPress={() => {
                dial(number);
              }}
            />
          )}
          {duration && episodeId !== null ? (
            <Button
              variant="secondary"
              size="crisis"
              icon={Clock}
              label={t('redflag.ended')}
              disabled={leaving}
              onPress={() => {
                fixTime(episodeId);
              }}
            />
          ) : null}
          <Button variant="secondary" size="crisis" label={t('redflag.safe')} disabled={leaving} onPress={close} />
        </View>
      </Screen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  frame: { gap: space[3] },
  content: { flexGrow: 1, gap: space[3] },
  head: { gap: space[2] },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  notice: { flexDirection: 'row', gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  noticeText: { flex: 1, gap: space[0] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  unknown: { gap: space[0] },
  // Full-bleed rule over the dock, as wide as the screen's gutters.
  dock: {
    gap: space[2],
    marginHorizontal: -space[3],
    paddingHorizontal: space[3],
    paddingTop: space[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  call: {
    minHeight: crisisControlHeight,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  pressLayer: { ...StyleSheet.absoluteFill, opacity: 0.16 },
  fill: { ...StyleSheet.absoluteFill },
  callRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1] },
  callLabel: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27, textAlign: 'center' },
  callSub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20, textAlign: 'center' },
});
