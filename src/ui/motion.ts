// Motion tokens per level, and the easings and springs every animation takes them with.
import { useMemo } from 'react';
import { Easing, FadeIn, FadeOut, ReduceMotion, useReducedMotion, withDelay, withTiming } from 'react-native-reanimated';
import type { EntryOrExitLayoutType } from 'react-native-reanimated';

import type { ThemeName } from '../profile/profileRepository';
import { useThemeState } from './themeContext';
import { useAccessibilityFlag } from './useAccessibilityFlag';

/** `full`: Day and Dark, transforms and springs. `subtle`: Dim, opacity and 8 pt moves. `fade`: reduced motion. */
export type MotionLevel = 'full' | 'subtle' | 'fade';

export interface MotionPreset {
  level: MotionLevel;
  duration: { fast: number; base: number; slow: number };
}

const DURATION = { fast: 120, base: 220, slow: 400 } as const;
const DIM_SCALE = 1.5;
const REDUCED_MS = 150;

export function motionFor(theme: ThemeName, reduced: boolean): MotionPreset {
  if (reduced) {
    return { level: 'fade', duration: { fast: REDUCED_MS, base: REDUCED_MS, slow: REDUCED_MS } };
  }
  if (theme === 'dim') {
    return {
      level: 'subtle',
      duration: { fast: DURATION.fast * DIM_SCALE, base: DURATION.base * DIM_SCALE, slow: DURATION.slow * DIM_SCALE },
    };
  }
  return { level: 'full', duration: { ...DURATION } };
}

export const easing = {
  /** Entrances, presses and exits at `full`. */
  out: Easing.bezier(0.23, 1, 0.32, 1),
  /** On-screen turns at `full`. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Every `subtle` animation: a softer start than `out`. */
  calm: Easing.bezier(0.33, 1, 0.68, 1),
  /** Every `fade` cross-fade. */
  linear: Easing.linear,
};

/** The default easing of a level. */
export function easingFor(level: MotionLevel): (typeof easing)[keyof typeof easing] {
  switch (level) {
    case 'full':
      return easing.out;
    case 'subtle':
      return easing.calm;
    case 'fade':
      return easing.linear;
  }
}

/**
 * An entering animation at the level: a rise of `dy` pt (opacity with translateY) at `base`, starting
 * `delay` ms later, or at `fade` the reduced cross-fade with no movement and no delay.
 */
export function entrance(motion: MotionPreset, dy: number, delay = 0): EntryOrExitLayoutType {
  if (motion.level === 'fade') {
    return FadeIn.duration(motion.duration.base).easing(easing.linear).reduceMotion(ReduceMotion.Never);
  }
  const duration = motion.duration.base;
  const curve = easingFor(motion.level);
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: dy }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, { duration, easing: curve, reduceMotion: ReduceMotion.Never })),
        transform: [{ translateY: withDelay(delay, withTiming(0, { duration, easing: curve, reduceMotion: ReduceMotion.Never })) }],
      },
    };
  };
}

/** The `fast` cross-fade pair for a value that changes in place (a label, a number). */
export function crossFade(motion: MotionPreset): { entering: EntryOrExitLayoutType; exiting: EntryOrExitLayoutType } {
  const curve = easingFor(motion.level);
  return {
    entering: FadeIn.duration(motion.duration.fast).easing(curve).reduceMotion(ReduceMotion.Never),
    exiting: FadeOut.duration(motion.duration.fast).easing(curve).reduceMotion(ReduceMotion.Never),
  };
}

/** Pass a duration token as the spring's perceptual `duration`; 0.85 shows no visible bounce. */
export const spring = { dampingRatio: 0.85 } as const;

/** Reduced when the OS setting or the in-app switch is on. */
export function useMotion(): MotionPreset {
  const { name, reduceMotion } = useThemeState();
  const osReduced = useAccessibilityFlag('reduceMotionChanged', useReducedMotion());
  return useMemo(() => motionFor(name, osReduced || reduceMotion), [name, osReduced, reduceMotion]);
}
