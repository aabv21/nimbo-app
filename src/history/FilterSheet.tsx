// The filter sheet over the list: the button names how many attacks the choices leave, before applying.
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Dose } from '../cabinet/doseStore';
import { Chip } from '../checkin/Chip';
import { packs } from '../condition';
import type { Episode } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { alpha } from '../ui/color';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { useSheetMotion } from '../ui/useSheetMotion';
import { EMPTY_FILTER, filterEpisodes } from './filterEpisodes';
import type { EpisodeFilter } from './filterEpisodes';

const MIN_INTENSITIES = [4, 7] as const;
const PERIODS: readonly { value: EpisodeFilter['period']; label: MessageKey }[] = [
  { value: '30d', label: 'history.filter.30d' },
  { value: '90d', label: 'history.filter.90d' },
  { value: 'all', label: 'history.filter.all' },
];
const DOSES: readonly { value: EpisodeFilter['doses']; label: MessageKey }[] = [
  { value: 'any', label: 'history.filter.any' },
  { value: 'with', label: 'history.filter.with_dose' },
  { value: 'without', label: 'history.filter.without_dose' },
];

interface FilterSheetProps {
  episodes: readonly Episode[];
  doses: readonly Dose[];
  /** What is applied now; the sheet edits a copy until Apply. */
  filter: EpisodeFilter;
  now: Date;
  onApply: (filter: EpisodeFilter) => void;
  /** Called once the sheet has left the screen. */
  onClosed: () => void;
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
        {title}
      </Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

export function FilterSheet({ episodes, doses, filter, now, onApply, onClosed }: FilterSheetProps): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrimStyle, sheetStyle, close } = useSheetMotion(onClosed);
  const [draft, setDraft] = useState(filter);
  const set = (patch: Partial<EpisodeFilter>): void => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  // Only triggers the user has logged, so no chip leads to an empty list.
  const logged = new Set(episodes.flatMap((episode) => episode.triggers));
  const triggers = packs.migraine.triggers.filter((item) => item.key === draft.trigger || logged.has(item.key));
  const count = filterEpisodes(episodes, doses, draft, now, (key) => t(key as MessageKey)).length;

  return (
    <Modal transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }, scrimStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.border }, sheetStyle]}>
          <View style={[styles.grip, { backgroundColor: color.border }]} />
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
            <View style={styles.head}>
              <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
                {t('history.filters.title')}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={styles.closeButton}>
                <X size={24} color={color.textMuted} />
              </Pressable>
            </View>

            <Group title={t('history.filter.intensity')}>
              <Chip role="radio" label={t('history.filter.any')} selected={draft.minIntensity === null} onPress={() => { set({ minIntensity: null }); }} />
              {MIN_INTENSITIES.map((min) => (
                <Chip
                  key={min}
                  role="radio"
                  label={t('history.filter.min', { n: min })}
                  selected={draft.minIntensity === min}
                  onPress={() => { set({ minIntensity: min }); }}
                />
              ))}
            </Group>

            {triggers.length === 0 ? null : (
              <Group title={t('history.filter.trigger')}>
                {triggers.map((item) => (
                  <Chip
                    key={item.key}
                    role="checkbox"
                    label={t(item.labelKey as MessageKey)}
                    selected={draft.trigger === item.key}
                    onPress={() => { set({ trigger: draft.trigger === item.key ? null : item.key }); }}
                  />
                ))}
              </Group>
            )}

            <Group title={t('history.filter.doses')}>
              {DOSES.map((option) => (
                <Chip key={option.value} role="radio" label={t(option.label)} selected={draft.doses === option.value} onPress={() => { set({ doses: option.value }); }} />
              ))}
            </Group>

            <Group title={t('history.filter.period')}>
              {PERIODS.map((option) => (
                <Chip key={option.value} role="radio" label={t(option.label)} selected={draft.period === option.value} onPress={() => { set({ period: option.value }); }} />
              ))}
            </Group>

            <View style={styles.actions}>
              <Button
                variant="secondary"
                label={t('history.filter.clear')}
                onPress={() => {
                  // The search box is outside the sheet, so clearing the choices leaves what was typed.
                  setDraft({ ...EMPTY_FILTER, query: draft.query });
                }}
              />
              <Button
                label={tp('history.filter.apply', count)}
                style={styles.grow}
                onPress={() => {
                  onApply(draft);
                  close();
                }}
              />
            </View>
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
    maxHeight: '90%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderTopWidth: 1,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: space[1] },
  content: { gap: space[4], padding: space[4] },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  closeButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  group: { gap: space[2] },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
