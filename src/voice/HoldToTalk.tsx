// The mic you hold: press in starts dictation, release finishes it, a slide up of 48 pt cancels. Nothing renders on
// a phone with no recognizer. A screen reader activates it once to start and once to finish.
import * as Haptics from 'expo-haptics';
import { Mic } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AccessibilityActionEvent, GestureResponderEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { controlHeight, crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { useDictation } from './dictation';
import type { DictationProblem } from './dictation';

/** How far up the finger slides, from where it pressed, to cancel instead of finishing. */
export const CANCEL_DISTANCE = 48;

interface HoldToTalkProps {
  label: string;
  hint: string;
  onHeard: (text: string) => void;
  size: 'regular' | 'crisis';
  /** Dictation is used up today (or nothing can be sent): shown, never started. */
  disabled?: boolean;
  /** For a screen that changes around a held mic. */
  onListening?: (listening: boolean) => void;
  /** Each problem as it is set, and null when a new press clears it; the screen shows the line where it fits. */
  onProblem?: (problem: DictationProblem | null) => void;
}

export function HoldToTalk({ label, hint, onHeard, size, disabled = false, onListening, onProblem }: HoldToTalkProps): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const dictation = useDictation(onHeard);
  const { listening, problem } = dictation;
  const pressedAt = useRef<number | null>(null);
  const lastY = useRef(0);

  // The latest callbacks, so a parent's re-render doesn't count as a change.
  const callbacks = useRef({ onListening, onProblem });
  useEffect(() => {
    callbacks.current = { onListening, onProblem };
  });
  useEffect(() => {
    callbacks.current.onListening?.(listening);
  }, [listening]);
  useEffect(() => {
    callbacks.current.onProblem?.(problem);
  }, [problem]);

  if (!dictation.available) return null;

  const grant = (event: GestureResponderEvent): void => {
    if (disabled) return;
    pressedAt.current = event.nativeEvent.pageY;
    lastY.current = event.nativeEvent.pageY;
    onPressIn();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    dictation.start();
  };
  const release = (event: GestureResponderEvent): void => {
    const from = pressedAt.current;
    pressedAt.current = null;
    onPressOut();
    if (from === null) return;
    const y = typeof event.nativeEvent.pageY === 'number' ? event.nativeEvent.pageY : lastY.current;
    if (from - y >= CANCEL_DISTANCE) dictation.cancel();
    else dictation.finish();
  };
  const terminate = (): void => {
    pressedAt.current = null;
    onPressOut();
    dictation.cancel();
  };
  const activate = (event: AccessibilityActionEvent): void => {
    if (disabled || event.nativeEvent.actionName !== 'activate') return;
    if (listening) dictation.finish();
    else dictation.start();
  };

  const crisis = size === 'crisis';
  const fill = disabled ? tones.disabledFill : listening || crisis ? color.accent : 'transparent';
  const ink = disabled ? color.textMuted : listening || crisis ? color.onAccent : color.accentText;

  return (
    <View style={crisis ? styles.crisisWrap : null}>
      {crisis && listening ? <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.listening.cancel')}</Text> : null}
      <Animated.View style={scaleStyle}>
        <View
          accessible
          accessibilityRole="button"
          accessibilityLabel={listening ? t('crisis.listening.held') : label}
          accessibilityHint={hint}
          accessibilityState={{ disabled, busy: listening }}
          accessibilityActions={[{ name: 'activate' }]}
          onAccessibilityAction={activate}
          onStartShouldSetResponder={() => !disabled}
          onResponderTerminationRequest={() => false}
          onResponderGrant={grant}
          onResponderMove={(event) => {
            lastY.current = event.nativeEvent.pageY;
          }}
          onResponderRelease={release}
          onResponderTerminate={terminate}
          style={[
            crisis ? styles.crisis : styles.regular,
            { backgroundColor: fill, borderColor: disabled || crisis || listening ? 'transparent' : color.textMuted },
          ]}
        >
          <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: crisis ? tones.pressAccent : tones.pressSecondary }, pressedStyle]} />
          {crisis ? (
            <>
              <View style={styles.row}>
                <Mic size={24} color={ink} />
                <Text style={[styles.crisisLabel, { color: ink }]}>{listening ? t('crisis.listening.held') : label}</Text>
              </View>
              {listening ? null : <Text style={[styles.sub, { color: ink }]}>{hint}</Text>}
            </>
          ) : (
            <Mic size={24} color={ink} />
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  crisisWrap: { gap: space[1] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18, textAlign: 'center' },
  regular: {
    width: controlHeight,
    height: controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  crisis: {
    minHeight: crisisControlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  crisisLabel: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27, textAlign: 'center' },
  sub: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18, textAlign: 'center' },
});
