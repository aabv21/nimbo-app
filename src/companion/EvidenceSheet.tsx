// The records behind an evidence chip, read from this phone: the attacks it counts, or the dose days for overuse.
import { X } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Dose } from '../cabinet/doseStore';
import type { Medication } from '../cabinet/medicationStore';
import type { Episode } from '../episodes/episodeStore';
import { stamp } from '../history/dateLabels';
import { EpisodeRow } from '../history/EpisodeRow';
import { useI18n } from '../i18n';
import { alpha } from '../ui/color';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { useSheetMotion } from '../ui/useSheetMotion';
import type { Evidence } from './contract';
import { evidenceLabel } from './EvidenceChips';

interface EvidenceSheetProps {
  evidence: Evidence;
  episodes: readonly Episode[];
  doses: readonly Dose[];
  medications: readonly Medication[];
  now: Date;
  /** A row was tapped: the parent drops the sheet at once (a modal would cover the next screen) and opens the attack. */
  onOpenEpisode: (id: string) => void;
  /** Called once the sheet has left the screen. */
  onClosed: () => void;
}

export function EvidenceSheet({ evidence, episodes, doses, medications, now, onOpenEpisode, onClosed }: EvidenceSheetProps): React.JSX.Element {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrimStyle, sheetStyle, close } = useSheetMotion(onClosed);

  const episodeIds = new Set(evidence.episodeIds);
  const doseIds = new Set(evidence.doseIds);
  // Records deleted since, or not yet on this phone, are simply not listed.
  const counted = evidence.source === 'overuse' ? [] : episodes.filter((episode) => episodeIds.has(episode.id));
  const nameOf = new Map(medications.map((medication) => [medication.id, medication.name]));
  // An overuse signal lists its doses too; every other source names none.
  const doseRows = evidence.source === 'overuse' || evidence.source === 'signal' ? doses.filter((dose) => doseIds.has(dose.id)) : [];

  return (
    <Modal transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }, scrimStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={t('evidence.sheet.label')}
          style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.border }, sheetStyle]}
        >
          <View style={[styles.grip, { backgroundColor: color.border }]} />
          <View style={styles.head}>
            <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
              {evidenceLabel(evidence, i18n)}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={styles.closeButton}>
              <X size={24} color={color.textMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
            {counted.map((episode) => (
              <EpisodeRow key={episode.id} episode={episode} now={now} onPress={onOpenEpisode} />
            ))}
            {doseRows.map((dose) => (
              <View key={dose.id} style={[styles.doseRow, { borderBottomColor: color.border }]}>
                <Text style={[styles.body, { color: color.text }]}>
                  {t('evidence.doses.row', { med: nameOf.get(dose.medicationId) ?? '', time: stamp(new Date(dose.takenAt), locale) })}
                </Text>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: space[1] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[1], paddingHorizontal: space[4], paddingTop: space[2] },
  closeButton: { minWidth: controlHeight, minHeight: controlHeight, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  content: { paddingHorizontal: space[4] },
  doseRow: { minHeight: controlHeight, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
