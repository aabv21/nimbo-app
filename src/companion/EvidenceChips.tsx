// The chips under a reply: each names a number the reply rests on and opens the records behind it.
import { ChevronRight, FileText } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import type { I18n } from '../i18n';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import type { Evidence } from './contract';

/** The chip's words, which the sheet repeats as its title. Code counted every number; the model only cites it. */
export function evidenceLabel(evidence: Evidence, { t, tp }: Pick<I18n, 't' | 'tp'>): string {
  const { count, of } = evidence;
  switch (evidence.source) {
    case 'episodes':
      return of === null ? tp('evidence.episodes', count) : t('evidence.trigger_frequency', { count, of });
    case 'crisis_plan':
      return t('crisis.helped.row', { n: count, of: of ?? count });
    case 'overuse':
      return of === null ? tp('today.med.days_nolimit', count, { used: count }) : t('today.med.days', { used: count, limit: of });
    case 'insight':
      return t('evidence.insight', { count, of: of ?? count });
    // A signal cites medicine days against their limit, or the nights before attacks (no `of`).
    case 'signal':
      return of === null ? tp('evidence.attack_nights', count) : t('today.med.days', { used: count, limit: of });
  }
}

function Chip({ evidence, onOpen }: { evidence: Evidence; onOpen: (evidence: Evidence) => void }): React.JSX.Element {
  const i18n = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const label = evidenceLabel(evidence, i18n);
  return (
    <Animated.View style={[styles.frame, scaleStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          onOpen(evidence);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.chip, { borderColor: tones.opaquePillEdge, backgroundColor: tones.opaquePill }]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <FileText size={16} color={color.accentText} />
        <Text style={[styles.label, { color: color.accentText }]}>{label}</Text>
        <ChevronRight size={16} color={color.accentText} />
      </Pressable>
    </Animated.View>
  );
}

/** An insight resting on no attack (a stretch with none, a month with none) would open an empty sheet: no chip. */
export function hasRecords(evidence: Evidence): boolean {
  return evidence.source !== 'insight' || evidence.episodeIds.length > 0;
}

export function EvidenceChips({ evidence, onOpen }: { evidence: readonly Evidence[]; onOpen: (evidence: Evidence) => void }): React.JSX.Element | null {
  const shown = evidence.filter(hasRecords);
  if (shown.length === 0) return null;
  return (
    <View style={styles.row}>
      {shown.map((item) => (
        <Chip key={item.ref} evidence={item} onOpen={onOpen} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  frame: { alignSelf: 'flex-start' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    minHeight: controlHeight,
    paddingHorizontal: space[2],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  label: { flexShrink: 1, fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
});
