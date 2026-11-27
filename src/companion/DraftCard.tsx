// A record the companion proposed, shown field by field; nothing is saved until Confirm, and Edit changes only the draft.
import * as Haptics from 'expo-haptics';
import { Check } from 'lucide-react-native';
import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { EntryOrExitLayoutType } from 'react-native-reanimated';

import type { Medication } from '../cabinet/medicationStore';
import type { CatalogName } from '../condition';
import type { Episode } from '../episodes/episodeStore';
import { dayTitle, stamp } from '../history/dateLabels';
import { catalogLabelKey } from '../history/labels';
import { useI18n } from '../i18n';
import type { I18n, MessageKey } from '../i18n';
import { formatClock } from '../i18n/format';
import { localDate } from '../lib/localDate';
import { Button } from '../ui/Button';
import { entrance, useMotion } from '../ui/motion';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import type { CheckinDraft, DoseDraft, Draft, EpisodeDraft } from './contract';

type Row = { label: MessageKey; value: string };
type Words = Pick<I18n, 't' | 'locale'>;

/** "Today, 08:00", "Yesterday, 16:00", or the date and time further back. */
export function whenLabel(iso: string, now: Date, { t, locale }: Words): string {
  const date = new Date(iso);
  const time = formatClock(date, locale);
  const day = localDate(date);
  if (day === localDate(now)) return t('draft.v.today_at', { time });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  return day === localDate(yesterday) ? t('draft.v.yesterday_at', { time }) : stamp(date, locale);
}

function labels(catalog: CatalogName, keys: readonly string[], t: I18n['t']): string {
  return keys.flatMap((key) => {
    const label = catalogLabelKey(catalog, key);
    return label === null ? [] : [t(label)];
  }).join(t('common.list.separator'));
}

function episodeRows(draft: EpisodeDraft, episodes: readonly Episode[], names: ReadonlyMap<string, string>, now: Date, text: Words): Row[] {
  const { t, locale } = text;
  const unsaid = t('draft.v.unsaid');
  const rows: Row[] = [];
  const isNew = draft.episodeId === null;
  if (!isNew) {
    const episode = episodes.find((item) => item.id === draft.episodeId);
    if (episode !== undefined) {
      const start = new Date(episode.startedAt);
      rows.push({
        label: 'draft.k.episode',
        value: episode.endedAt === null ? t('draft.v.episode_open', { time: formatClock(start, locale) }) : dayTitle(start, locale),
      });
    }
  }
  // A new attack shows its core fields even when unsaid, so the gap is visible; a change shows only what it changes.
  const add = (label: MessageKey, value: string | null, core: boolean): void => {
    if (value !== null && value !== '') rows.push({ label, value });
    else if (isNew && core) rows.push({ label, value: unsaid });
  };
  add('draft.k.started', draft.startedAt === null ? null : whenLabel(draft.startedAt, now, text), true);
  add('draft.k.ended', draft.endedAt === null ? null : whenLabel(draft.endedAt, now, text), true);
  add('crisis.intensity.label', draft.intensity === null ? null : String(draft.intensity), true);
  add('draft.k.where', labels('painAreas', draft.painAreas, t), false);
  add('draft.k.symptoms', labels('symptoms', draft.symptoms, t), false);
  add('draft.k.trigger', labels('triggers', draft.triggers, t), true);
  add('episode.reliefs', labels('reliefs', draft.reliefs, t), false);
  add('draft.k.helped', labels('reliefs', draft.helped, t), false);
  add('draft.k.not_helped', labels('reliefs', draft.didNotHelp, t), false);
  for (const dose of draft.doses) {
    add('draft.k.dose', t('draft.v.dose', { med: names.get(dose.medicationId) ?? unsaid, time: formatClock(new Date(dose.takenAt), locale) }), false);
  }
  return rows;
}

function doseRows(draft: DoseDraft, medication: Medication | undefined, episodes: readonly Episode[], now: Date, text: Words): Row[] {
  const { t, locale } = text;
  const rows: Row[] = [
    { label: 'draft.k.medication', value: medication?.name ?? t('draft.v.unsaid') },
    { label: 'draft.k.when', value: whenLabel(draft.takenAt, now, text) },
  ];
  if (medication?.doseText != null) rows.push({ label: 'draft.k.dose_text', value: medication.doseText });
  const episode = draft.episodeId === null ? undefined : episodes.find((item) => item.id === draft.episodeId);
  if (episode !== undefined) {
    const start = new Date(episode.startedAt);
    rows.push({
      label: 'draft.k.episode',
      value: episode.endedAt === null ? t('draft.v.episode_open', { time: formatClock(start, locale) }) : dayTitle(start, locale),
    });
  }
  return rows;
}

const CHECKIN_FLAGS: readonly { read: (draft: CheckinDraft) => boolean | null; label: MessageKey }[] = [
  { read: (draft) => draft.lowWater, label: 'checkin.water' },
  { read: (draft) => draft.extraCaffeine, label: 'checkin.caffeine' },
  { read: (draft) => draft.alcohol, label: 'checkin.alcohol' },
  { read: (draft) => draft.skippedMeal, label: 'checkin.skipped_meal' },
  { read: (draft) => draft.screenHeavy, label: 'checkin.screens' },
];

function checkinRows(draft: CheckinDraft, { t }: Words): Row[] {
  const unsaid = t('draft.v.unsaid');
  const rows: Row[] = [
    { label: 'draft.k.sleep', value: draft.sleepBand === null ? unsaid : t(`checkin.sleep.${draft.sleepBand}`) },
    { label: 'draft.k.quality', value: draft.sleepQuality === null ? unsaid : t(`checkin.quality.${draft.sleepQuality}`) },
    { label: 'draft.k.stress', value: draft.stress === null ? unsaid : t(`checkin.stress.${draft.stress}`) },
  ];
  for (const { read, label } of CHECKIN_FLAGS) {
    const value = read(draft);
    if (value !== null) rows.push({ label, value: t(value ? 'draft.v.yes' : 'draft.v.no') });
  }
  return rows;
}

const TITLE: Record<Draft['kind'], MessageKey> = { episode: 'draft.episode.title', dose: 'draft.dose.title', checkin: 'draft.checkin.title' };

interface DraftCardProps {
  messageId: number;
  draft: Draft;
  /** Set once Confirm has saved it. */
  confirmed: boolean;
  /** The card arrived after the chat was shown, so it assembles row by row; one already there appears as it is. */
  fresh: boolean;
  episodes: readonly Episode[];
  medications: readonly Medication[];
  now: Date;
  onConfirm: (messageId: number, ref: string) => 'ok' | 'invalid';
  onEdit: (messageId: number, draft: Draft) => void;
  /** Crisis mode puts Edit and Confirm in its dock, in the thumb zone, so the card shows none of its own. */
  docked?: boolean;
}

export const DraftCard = memo(function DraftCard({
  messageId,
  draft,
  confirmed,
  fresh,
  episodes,
  medications,
  now,
  onConfirm,
  onEdit,
  docked = false,
}: DraftCardProps): React.JSX.Element {
  const i18n = useI18n();
  const { t } = i18n;
  const { color } = useTheme();
  const motion = useMotion();
  const [invalid, setInvalid] = useState(false);

  const names = new Map(medications.map((medication) => [medication.id, medication.name]));
  const medication = draft.kind === 'dose' ? medications.find((item) => item.id === draft.medicationId) : undefined;
  const rows =
    draft.kind === 'episode'
      ? episodeRows(draft, episodes, names, now, i18n)
      : draft.kind === 'dose'
        ? doseRows(draft, medication, episodes, now, i18n)
        : checkinRows(draft, i18n);

  const animate = fresh && motion.level !== 'fade';
  // Day: each row rises 8, 40 ms apart; Dim: rows only fade, 60 ms apart; reduced: the card's fade covers them.
  const rowEntering = (index: number): { entering?: EntryOrExitLayoutType } =>
    animate ? { entering: entrance(motion, motion.level === 'full' ? 8 : 0, (motion.level === 'full' ? 40 : 60) * (index + 1)) } : {};

  const confirm = (): void => {
    const result = onConfirm(messageId, draft.ref);
    setInvalid(result === 'invalid');
    if (result === 'ok') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <Animated.View
      {...(fresh ? { entering: entrance(motion, motion.level === 'full' ? 12 : 8) } : {})}
      style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}
    >
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t(TITLE[draft.kind])}
        </Text>
        <Text style={[styles.small, { color: color.textMuted }]}>{t('draft.sub')}</Text>
      </View>
      <View style={styles.rows}>
        {rows.map((row, index) => (
          <Animated.View key={`${row.label}-${String(index)}`} {...rowEntering(index)} style={styles.row}>
            <Text style={[styles.small, { color: color.textMuted }]}>{t(row.label)}</Text>
            <Text style={[styles.value, { color: color.text }]}>{row.value}</Text>
          </Animated.View>
        ))}
      </View>
      {medication?.doseText != null ? <Text style={[styles.small, { color: color.textMuted }]}>{t('draft.dose.from_cabinet')}</Text> : null}
      {invalid && !confirmed ? (
        <Text accessibilityRole="alert" style={[styles.small, { color: color.danger }]}>
          {t('draft.error')}
        </Text>
      ) : null}
      {docked ? null : confirmed ? (
        <Button swap label={t('common.done')} icon={Check} onPress={() => undefined} />
      ) : (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            label={t('common.edit')}
            style={styles.grow}
            onPress={() => {
              setInvalid(false);
              onEdit(messageId, draft);
            }}
          />
          {/* Tappable from the first frame: the rows assemble around it, never blocking it. */}
          <Button label={t('common.confirm')} style={styles.grow} onPress={confirm} />
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: { gap: space[3], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  head: { gap: space[0] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  rows: { gap: space[2] },
  row: { gap: 2 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  value: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
