// The bottom sheet's motion, shared by the sheets that draw their own scrim: no native sheet, and no slide in Dim.
import { useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { easingFor, spring, useMotion } from './motion';

/**
 * The sheet's motion. Day: the sheet slides up on a spring while the scrim fades in, and both leave over `base`.
 * Dim: the sheet fades in with an 8 pt rise, out over `fast`. Reduced: both cross-fade. `close` runs `onClosed` when the exit ends.
 */
export function useSheetMotion(onClosed: () => void) {
  const motion = useMotion();
  const { height } = useWindowDimensions();
  const scrim = useSharedValue(0);
  const sheet = useSharedValue(0);
  const leaving = useRef(false);
  const { level } = motion;
  const { base, slow, fast } = motion.duration;
  const curve = easingFor(level);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.get() }));
  const sheetStyle = useAnimatedStyle(() => {
    const shown = sheet.get();
    if (level === 'full') return { transform: [{ translateY: (1 - shown) * height }] };
    return { opacity: shown, transform: [{ translateY: level === 'subtle' ? (1 - shown) * 8 : 0 }] };
  });

  useEffect(() => {
    scrim.set(withTiming(1, { duration: base, easing: curve, reduceMotion: ReduceMotion.Never }));
    sheet.set(
      level === 'full'
        ? withSpring(1, { duration: slow, ...spring, reduceMotion: ReduceMotion.Never })
        : withTiming(1, { duration: base, easing: curve, reduceMotion: ReduceMotion.Never }),
    );
  }, [scrim, sheet, level, base, slow, curve]);

  const close = (): void => {
    if (leaving.current) return;
    leaving.current = true;
    const duration = level === 'full' ? base : fast;
    scrim.set(withTiming(0, { duration, easing: curve, reduceMotion: ReduceMotion.Never }));
    sheet.set(
      withTiming(0, { duration, easing: curve, reduceMotion: ReduceMotion.Never }, (finished) => {
        'worklet';
        if (finished === true) scheduleOnRN(onClosed);
      }),
    );
  };

  return { scrimStyle, sheetStyle, close };
}
