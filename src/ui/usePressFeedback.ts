// Press feedback for any pressable: a pressed-tone layer cross-fades in, and only full motion also scales.
import { ReduceMotion, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { easingFor, useMotion } from './motion';

const PRESS_SCALE = 0.98;

/**
 * `scaleStyle` goes on the control's outer `Animated.View`; `pressedStyle` on an absolutely filled
 * `Animated.View` painted in the pressed tone.
 */
export function usePressFeedback() {
  const motion = useMotion();
  const pressed = useSharedValue(0);
  const level = motion.level;

  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: level === 'full' ? interpolate(pressed.get(), [0, 1], [1, PRESS_SCALE]) : 1 }],
  }));
  const pressedStyle = useAnimatedStyle(() => ({ opacity: pressed.get() }));

  const animate = (to: number): void => {
    pressed.set(
      withTiming(to, {
        duration: motion.duration.fast,
        easing: easingFor(level),
        // Nimbo supplies its own reduced variant; the system setting would skip the cross-fade.
        reduceMotion: ReduceMotion.Never,
      }),
    );
  };

  return {
    scaleStyle,
    pressedStyle,
    onPressIn: () => {
      animate(1);
    },
    onPressOut: () => {
      animate(0);
    },
  };
}
