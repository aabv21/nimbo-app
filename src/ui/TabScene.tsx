import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { easingFor, useMotion } from './motion';

/**
 * A tab's content rises in when the tab becomes the focused one (fades only, at reduced motion); tabs
 * are peers, so nothing slides sideways. `still` marks the tab the shell opens on, which appears as it is.
 * Only a focus change animates: a new motion level (Dim, Reduce motion) applies to the next change.
 */
export function TabScene({ focused, still, children }: { focused: boolean; still: boolean; children: ReactNode }): React.JSX.Element {
  const motion = useMotion();
  const shown = useSharedValue(still ? 1 : 0);
  const rise = motion.level === 'full' ? 12 : motion.level === 'subtle' ? 8 : 0;
  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * rise }],
  }));
  // Read by the focus effect, not a dependency of it: a settings change must not re-run the entrance.
  const motionRef = useRef(motion);
  const wasFocused = useRef(still);

  useEffect(() => {
    motionRef.current = motion;
  });

  useEffect(() => {
    const was = wasFocused.current;
    wasFocused.current = focused;
    if (!focused || was) return;
    const { level, duration } = motionRef.current;
    shown.set(0);
    shown.set(withTiming(1, { duration: duration.base, easing: easingFor(level), reduceMotion: ReduceMotion.Never }));
  }, [focused, shown]);

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
