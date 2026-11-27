// The sync banner: silent while synced, one muted line once work has been pending for a while, a notice
// with "Try again" when an operation failed. Each state cross-fades in and out.
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';

import { useI18n } from '../../i18n';
import { easingFor, useMotion } from '../../ui/motion';
import { Notice } from '../../ui/Notice';
import { fonts, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';
import { useSyncState } from './SyncProvider';

/** An upload that finishes sooner never shows "syncing", so a quick save does not flicker. */
const PENDING_DELAY_MS = 600;

export function SyncNotice(): React.JSX.Element | null {
  const { pending, failed, retry } = useSyncState();
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const hasPending = pending > 0;
  const [pendingShown, setPendingShown] = useState(false);

  useEffect(() => {
    if (!hasPending) return;
    const timer = setTimeout(() => {
      setPendingShown(true);
    }, PENDING_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setPendingShown(false);
    };
  }, [hasPending]);

  const state = failed > 0 ? 'failed' : hasPending && pendingShown ? 'pending' : null;
  if (state === null) return null;

  // The reduced level is itself a 150 ms fade, so it plays even when the OS asks for reduced motion.
  const ease = easingFor(motion.level);
  const entering = FadeIn.duration(motion.duration.base).easing(ease).reduceMotion(ReduceMotion.Never);
  const exiting = FadeOut.duration(motion.duration.base).easing(ease).reduceMotion(ReduceMotion.Never);

  return (
    <Animated.View key={state} entering={entering} exiting={exiting}>
      {state === 'failed' ? (
        <Notice
          tone="warning"
          title={t('sync.failed.title')}
          body={tp('sync.failed.body', failed)}
          action={{ label: t('common.retry'), onPress: retry }}
        />
      ) : (
        <Text accessibilityLiveRegion="polite" style={[styles.line, { color: color.textMuted }]}>
          {`${t('sync.pending')} · ${tp('sync.pending.count', pending)}`}
        </Text>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
});
