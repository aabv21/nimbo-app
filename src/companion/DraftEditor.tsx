// Edit on a draft card: the draft's fields in a sheet. Saving changes the draft in the message, never a record.
import { X } from 'lucide-react-native';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SLEEP_BANDS, STRESS_LEVELS } from '../checkin/CheckinCard';
import { Chip } from '../checkin/Chip';
import { packs } from '../condition';
import { IntensityScale } from '../crisis/IntensityScale';
import { DateTimeField } from '../history/DateTimeField';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { alpha } from '../ui/color';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { useSheetMotion } from '../ui/useSheetMotion';
import type { CheckinDraft, Draft, EpisodeDraft } from './contract';

const QUALITIES = ['bad', 'ok', 'good'] as const;

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

const toggle = (keys: readonly string[], key: string): string[] => (keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key]);

interface KeyChipsProps {
  items: readonly { key: string; labelKey: string }[];
  title: string;
  selected: readonly string[];
  onChange: (keys: string[]) => void;
}

function KeyChips({ items, title, selected, onChange }: KeyChipsProps): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Group title={title}>
      {items.map((item) => (
        <Chip
          key={item.key}
          role="checkbox"
          label={t(item.labelKey as MessageKey)}
          selected={selected.includes(item.key)}
          onPress={() => {
            onChange(toggle(selected, item.key));
          }}
        />
      ))}
    </Group>
  );
}

function EpisodeFields({ draft, onChange }: { draft: EpisodeDraft; onChange: (draft: EpisodeDraft) => void }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const unsaid = t('draft.v.unsaid');
  const endBeforeStart = draft.startedAt !== null && draft.endedAt !== null && new Date(draft.endedAt) < new Date(draft.startedAt);
  return (
    <>
      <DateTimeField
        label={t('draft.k.started')}
        value={draft.startedAt === null ? null : new Date(draft.startedAt)}
        empty={unsaid}
        onChange={(value) => {
          onChange({ ...draft, startedAt: value.toISOString() });
        }}
      />
      <DateTimeField
        label={t('draft.k.ended')}
        value={draft.endedAt === null ? null : new Date(draft.endedAt)}
        empty={unsaid}
        invalid={endBeforeStart}
        onChange={(value) => {
          onChange({ ...draft, endedAt: value.toISOString() });
        }}
      />
      <View style={styles.group}>
        <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
          {t('crisis.intensity.label')}
        </Text>
        <IntensityScale
          value={draft.intensity}
          onChange={(value) => {
            onChange({ ...draft, intensity: value });
          }}
        />
      </View>
      <KeyChips items={packs.migraine.triggers} title={t('draft.k.trigger')} selected={draft.triggers} onChange={(triggers) => { onChange({ ...draft, triggers }); }} />
      <KeyChips
        items={packs.migraine.reliefs}
        title={t('draft.k.helped')}
        selected={draft.helped}
        onChange={(helped) => {
          onChange({ ...draft, helped, didNotHelp: draft.didNotHelp.filter((key) => !helped.includes(key)) });
        }}
      />
    </>
  );
}

function CheckinFields({ draft, onChange }: { draft: CheckinDraft; onChange: (draft: CheckinDraft) => void }): React.JSX.Element {
  const { t } = useI18n();
  // Tapping the chosen answer again clears it, back to "You didn't say".
  return (
    <>
      <Group title={t('draft.k.sleep')}>
        {SLEEP_BANDS.map((value) => (
          <Chip key={value} role="radio" label={t(`checkin.sleep.${value}`)} selected={draft.sleepBand === value} onPress={() => { onChange({ ...draft, sleepBand: draft.sleepBand === value ? null : value }); }} />
        ))}
      </Group>
      <Group title={t('draft.k.quality')}>
        {QUALITIES.map((value) => (
          <Chip key={value} role="radio" label={t(`checkin.quality.${value}`)} selected={draft.sleepQuality === value} onPress={() => { onChange({ ...draft, sleepQuality: draft.sleepQuality === value ? null : value }); }} />
        ))}
      </Group>
      <Group title={t('draft.k.stress')}>
        {STRESS_LEVELS.map((value) => (
          <Chip key={value} role="radio" label={t(`checkin.stress.${value}`)} selected={draft.stress === value} onPress={() => { onChange({ ...draft, stress: draft.stress === value ? null : value }); }} />
        ))}
      </Group>
    </>
  );
}

const TITLE: Record<Draft['kind'], MessageKey> = { episode: 'draft.episode.title', dose: 'draft.dose.title', checkin: 'draft.checkin.title' };

interface DraftEditorProps {
  draft: Draft;
  onSave: (draft: Draft) => void;
  /** Called once the sheet has left the screen. */
  onClosed: () => void;
}

export function DraftEditor({ draft: initial, onSave, onClosed }: DraftEditorProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const { scrimStyle, sheetStyle, close } = useSheetMotion(onClosed);
  const [draft, setDraft] = useState<Draft>(initial);

  return (
    <Modal transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }, scrimStyle]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.border }, sheetStyle]}>
          <View style={[styles.grip, { backgroundColor: color.border }]} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, space[4]) }]}>
            <View style={styles.head}>
              <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
                {t(TITLE[draft.kind])}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={close} style={styles.closeButton}>
                <X size={24} color={color.textMuted} />
              </Pressable>
            </View>
            {draft.kind === 'episode' ? <EpisodeFields draft={draft} onChange={setDraft} /> : null}
            {draft.kind === 'dose' ? (
              <DateTimeField
                label={t('draft.k.when')}
                value={new Date(draft.takenAt)}
                empty={t('draft.v.unsaid')}
                onChange={(value) => {
                  setDraft({ ...draft, takenAt: value.toISOString() });
                }}
              />
            ) : null}
            {draft.kind === 'checkin' ? <CheckinFields draft={draft} onChange={setDraft} /> : null}
            <Button
              label={t('common.save')}
              onPress={() => {
                onSave(draft);
                close();
              }}
            />
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
  closeButton: { minWidth: controlHeight, minHeight: controlHeight, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  group: { gap: space[2] },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
