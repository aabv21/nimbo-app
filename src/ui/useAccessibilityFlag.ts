import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

type Flag = 'reduceMotionChanged' | 'reduceTransparencyChanged';

function read(flag: Flag): Promise<boolean> {
  return flag === 'reduceMotionChanged' ? AccessibilityInfo.isReduceMotionEnabled() : AccessibilityInfo.isReduceTransparencyEnabled();
}

/**
 * An OS accessibility setting, kept current while the app runs. Until the first read answers it is
 * `initial`, or `undefined` (unknown) when none is given, so a caller can pick its own safe default.
 */
export function useAccessibilityFlag(flag: Flag): boolean | undefined;
export function useAccessibilityFlag(flag: Flag, initial: boolean): boolean;
export function useAccessibilityFlag(flag: Flag, initial?: boolean): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(initial);

  useEffect(() => {
    let active = true;
    read(flag).then(
      (value) => {
        if (active) setEnabled(value);
      },
      // A platform without the query reports the setting as off rather than failing the screen.
      () => {
        if (active) setEnabled((current) => current ?? false);
      },
    );
    const subscription = AccessibilityInfo.addEventListener(flag, setEnabled);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [flag]);

  return enabled;
}
