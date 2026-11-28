// Today's "Signals today": up to three rows, or a line saying why there are none.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { entrance, spring, useMotion } from '../ui/motion';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import type { Signal } from './index';
import { SignalRow } from './SignalRow';
import { signalText } from './signalText';
import type { SignalActionKind } from './signalText';

// The rows on screen at the first render of a session rise in; after that a new visit, or a row that arrives later
// (the pressure row from the server, a row a check-in adds), shows in place.
let staggered = false;

interface SignalsSectionProps {
  rows: readonly Signal[];
  empty: 'new' | 'none' | null;
  knownTriggers: readonly string[];
  timeZone: string;
  onAction: (signal: Signal, kind: SignalActionKind) => void;
}

export function SignalsSection({ rows, empty, knownTriggers, timeZone, onAction }: SignalsSectionProps): React.JSX.Element {
  const { t, tp, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const [firstRows] = useState<ReadonlySet<string>>(() => new Set(staggered ? [] : rows.map((signal) => signal.causeKey)));
  useEffect(() => {
    if (rows.length > 0) staggered = true;
  }, [rows.length]);

  // Only full motion glides the rows below an opened one; Dim and reduced let them take their place at once.
  const layout = motion.level === 'full' ? LinearTransition.springify(motion.duration.base).dampingRatio(spring.dampingRatio).reduceMotion(ReduceMotion.Never) : undefined;
  const gap = motion.level === 'subtle' ? 60 : 40;
  const rise = motion.level === 'subtle' ? 4 : 8;

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('today.signals.title')}
      </Text>
      {empty === null ? (
        <View>
          {rows.map((signal, index) => (
            <Animated.View
              key={signal.causeKey}
              {...(layout === undefined ? {} : { layout })}
              // Reduced motion fades every row at once: no stagger.
              {...(firstRows.has(signal.causeKey) ? { entering: entrance(motion, rise, motion.level === 'fade' ? 0 : index * gap) } : {})}
            >
              <SignalRow
                signal={signal}
                text={signalText(signal, { t, tp, locale, knownTriggers, timeZone })}
                onAction={(kind) => {
                  onAction(signal, kind);
                }}
              />
            </Animated.View>
          ))}
        </View>
      ) : (
        <Text style={[styles.small, { color: color.textMuted }]}>{t(empty === 'new' ? 'today.signals.empty' : 'today.signals.none')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
});
