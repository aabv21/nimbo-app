// A stand-in for react-native-reanimated under Jest, mapped for every suite in jest.setup.ts: its own
// mock loads react-native-worklets' native module and crashes under jest-expo.
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

// What it models (anything else the app imports must be added here):
// - `useSharedValue`: a box whose writes (`.value` or `.set()`) never re-render a plain render, as on a
//   device, so a component that reads it straight into a style is caught.
// - `useAnimatedStyle`: records the boxes its factory reads (as the Babel plugin finds a worklet's
//   shared values) and re-renders when one changes; declare it before any effect that writes them.
// - `withTiming`, `withSpring`, `withDelay`: settle at once on the target, as Reanimated's own mock does;
//   `withTiming` also calls its completion callback with `finished: true`.
// - `interpolate`, `interpolateColor`: linear and nearest-stop, enough to assert a settled style.
// - `FadeIn`, `FadeOut`: layout-animation builders whose modifiers chain and do nothing; the view mounts settled.

export function useReducedMotion(): boolean {
  return false;
}

type Listener = () => void;
type SharedValueBox<T> = { value: T; get: () => T; set: (next: T) => void; _listeners: Set<Listener> };

// The boxes a `useAnimatedStyle` factory reads while it runs; null outside a factory.
const tracker: { reading: Set<{ _listeners: Set<Listener> }> | null } = { reading: null };

export function useSharedValue<T>(initial: T): { value: T; get: () => T; set: (next: T) => void } {
  const [box] = useState<SharedValueBox<T>>(() => {
    const listeners = new Set<Listener>();
    let current = initial;
    return {
      _listeners: listeners,
      get value() {
        tracker.reading?.add(this);
        return current;
      },
      set value(next: T) {
        current = next;
        for (const listener of listeners) {
          listener();
        }
      },
      // Reanimated 4's React Compiler-safe accessors, the same box as `.value`.
      get(): T {
        return this.value;
      },
      set(next: T): void {
        this.value = next;
      },
    };
  });
  return box;
}

export function useAnimatedStyle<T>(factory: () => T): T {
  const [, forceRender] = useState(0);
  const previous = tracker.reading;
  const read = new Set<{ _listeners: Set<Listener> }>();
  tracker.reading = read;
  let style: T;
  try {
    style = factory();
  } finally {
    tracker.reading = previous;
  }
  const boxes = [...read];

  useEffect(() => {
    const onChange = () => {
      forceRender((tick) => tick + 1);
    };
    for (const box of boxes) {
      box._listeners.add(onChange);
    }
    return () => {
      for (const box of boxes) {
        box._listeners.delete(onChange);
      }
    };
  }, boxes);

  return style;
}

/** Settles at once and reports a finished run to the callback, as a device does once the duration passes. */
export function withTiming<T>(toValue: T, _config?: unknown, callback?: (finished?: boolean) => void): T {
  callback?.(true);
  return toValue;
}

export function withSpring<T>(toValue: T): T {
  return toValue;
}

export function withDelay<T>(_delay: number, animation: T): T {
  return animation;
}

export function interpolate(value: number, input: readonly number[], output: readonly number[]): number {
  const [x0 = 0, x1 = 1] = input;
  const [y0 = 0, y1 = 0] = output;
  if (x1 === x0) return y0;
  return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
}

export function interpolateColor(value: number, input: readonly number[], output: readonly string[]): string {
  const [, x1 = 1] = input;
  return (value >= x1 ? output[1] : output[0]) ?? '';
}

const identity = (t: number): number => t;

export const Easing = {
  bezier: () => identity,
  linear: identity,
};

/** A layout-animation builder: every modifier (`duration`, `easing`, `reduceMotion`, …) returns it again. */
function layoutAnimation(): unknown {
  const builder: unknown = new Proxy(
    {},
    {
      get: () => () => builder,
    },
  );
  return builder;
}

export const FadeIn = layoutAnimation();
export const FadeOut = layoutAnimation();

export const ReduceMotion = { System: 'system', Always: 'always', Never: 'never' } as const;

export function createAnimatedComponent<C>(component: C): C {
  return component;
}

export default { View, Text, createAnimatedComponent };
