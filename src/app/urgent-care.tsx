// The urgent-care screen for a red-flag hit: what was found, why it matters and one call button.
// It opens over anything, the same way every time: a short fade and a warning haptic, nothing that moves.
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { Clock, OctagonAlert, TriangleAlert } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { emergencyNumber, packs } from '../condition';
import { isMessageKey, useI18n } from '../i18n';
import { CallButton, dial, phoneRegion } from '../redflags/EmergencyCall';
import { clearUrgentCare, currentUrgentCare } from '../redflags/urgentCare';
import { Button } from '../ui/Button';
import { easing, motionFor } from '../ui/motion';
import { Screen } from '../ui/Screen';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';

function goBack(): void {
  router.back();
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
    router.replace(`/episode/${id}/edit`);
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
              testID="urgent-care-call"
              label={t('redflag.open_dialer')}
              sub={null}
              disabled={leaving}
              onPress={() => {
                dial('');
              }}
            />
          ) : (
            <CallButton
              testID="urgent-care-call"
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
          <Button testID="urgent-care-safe" variant="secondary" size="crisis" label={t('redflag.safe')} disabled={leaving} onPress={close} />
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
});
