// One signal on Today: a row with its reason that opens onto the detail, the source and what to do next.
// The chevron turns (or cross-fades) and the evidence drops into place: docs/app.md#signals-on-today.
import { CalendarCheck, ChevronDown, ChevronUp, Gauge, Hourglass, Moon, NotebookPen, Pill } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import type { IconProps } from '../ui/Button';
import { crossFade, easing, easingFor, entrance, useMotion } from '../ui/motion';
import { controlHeight, fonts, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import type { Signal } from './index';
import type { SignalActionKind, SignalText } from './signalText';

/** The provider's page, which its free-tier terms ask the app to link wherever its data shows. */
export const WEATHER_ATTRIBUTION_URL = 'https://open-meteo.com/';

const ICONS: Readonly<Record<Signal['kind'], ComponentType<IconProps>>> = {
  pressure: Gauge,
  short_sleep: Moon,
  overuse_warn: Pill,
  overuse_limit: Pill,
  long_attack: Hourglass,
  debrief_due: NotebookPen,
  quiet_tracker: CalendarCheck,
};

interface SignalRowProps {
  signal: Signal;
  text: SignalText;
  onAction: (kind: SignalActionKind) => void;
}

export function SignalRow({ signal, text, onAction }: SignalRowProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const motion = useMotion();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const [open, setOpen] = useState(false);
  const Icon = ICONS[signal.kind];

  // Full motion turns one chevron; Dim and reduced cross-fade two, since they never rotate.
  const turn = useSharedValue(0);
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.get() * 180)}deg` }] }));
  const upStyle = useAnimatedStyle(() => ({ opacity: turn.get() }));
  const downStyle = useAnimatedStyle(() => ({ opacity: 1 - turn.get() }));
  const level = motion.level;
  const fast = motion.duration.fast;
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: fast, easing: level === 'full' ? easing.inOut : easingFor(level), reduceMotion: ReduceMotion.Never }));
  }, [open, turn, fast, level]);

  const detailEntering = level === 'full' ? entrance(motion, -8, 40) : entrance(motion, -4);

  return (
    <View style={[styles.root, { borderColor: color.border }]}>
      <Animated.View style={scaleStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${text.title}. ${text.reason}`}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setOpen((value) => !value);
          }}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={styles.button}
        >
          <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
          <Icon size={22} color={color.accentText} />
          <View style={styles.words}>
            <Text style={[styles.title, { color: color.text }]}>{text.title}</Text>
            <Text style={[styles.reason, { color: color.textMuted }]}>{text.reason}</Text>
          </View>
          {level === 'full' ? (
            <Animated.View style={turnStyle}>
              <ChevronDown size={20} color={color.textMuted} />
            </Animated.View>
          ) : (
            <View style={styles.chevrons}>
              <Animated.View style={[styles.chevron, downStyle]}>
                <ChevronDown size={20} color={color.textMuted} />
              </Animated.View>
              <Animated.View style={[styles.chevron, upStyle]}>
                <ChevronUp size={20} color={color.textMuted} />
              </Animated.View>
            </View>
          )}
        </Pressable>
      </Animated.View>
      {open ? (
        <Animated.View entering={detailEntering} exiting={crossFade(motion).exiting} style={styles.detail}>
          <Text style={[styles.body, { color: color.text }]}>{text.detail}</Text>
          <Text style={[styles.caption, { color: color.textMuted }]}>{text.source}</Text>
          {text.attribution ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                Linking.openURL(WEATHER_ATTRIBUTION_URL).catch(() => undefined);
              }}
              style={styles.link}
            >
              <Text style={[styles.linkLabel, { color: color.accentText }]}>{t('signal.pressure.attribution')}</Text>
            </Pressable>
          ) : null}
          {text.action === null ? null : (
            <Button
              variant="secondary"
              label={text.action.label}
              onPress={() => {
                if (text.action !== null) onAction(text.action.kind);
              }}
            />
          )}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderTopWidth: StyleSheet.hairlineWidth },
  button: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight, paddingVertical: space[2], overflow: 'hidden' },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  words: { flex: 1, gap: space[0] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  reason: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  chevrons: { width: 20, height: 20 },
  chevron: { ...StyleSheet.absoluteFill },
  detail: { gap: space[2], paddingBottom: space[3], paddingLeft: 22 + space[2] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  link: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  linkLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20, textDecorationLine: 'underline' },
});
