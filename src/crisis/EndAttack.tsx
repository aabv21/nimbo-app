// Ending an attack: a confirmation sheet, so a stray tap never ends it, then a quiet summary of what was saved.
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { Dose } from '../cabinet/doseStore';
import type { Episode } from '../episodes/episodeStore';
import { formatClock, formatDuration, parseClock } from '../i18n/format';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { alpha } from '../ui/color';
import { entrance, useMotion } from '../ui/motion';
import { TextField } from '../ui/TextField';
import { TextLink } from '../ui/TextLink';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { resolveDoseTime } from './countdown';

const MINUTE_MS = 60 * 1000;

export function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);
}

interface EndSheetProps {
  startedAt: Date;
  timeZone: string;
  /** False when the attack could not be ended at that time; the sheet then stays, with an error. */
  onConfirm: (endedAt: Date) => boolean;
  onNotYet: () => void;
}

/** "Is the attack over?": the end defaults to now; a typed time later than now is yesterday's. */
export function EndSheet({ startedAt, timeZone, onConfirm, onNotYet }: EndSheetProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const [endAt] = useState(() => new Date());
  const [changing, setChanging] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Shown in the time field, so an error always comes with a way to type another time.
  const refuse = (message: string): void => {
    setChanging(true);
    setError(message);
  };
  const confirm = (): void => {
    let endedAt = endAt;
    if (changing) {
      const clock = parseClock(typed);
      if (clock === null) {
        refuse(t('dose.time.error'));
        return;
      }
      endedAt = resolveDoseTime(clock, new Date(), timeZone);
    }
    // The default end too: a start a few minutes ahead (another phone's clock) can put "now" before it.
    if (endedAt.getTime() < startedAt.getTime()) {
      refuse(t('crisis.over.time.before', { time: formatClock(startedAt, locale) }));
      return;
    }
    if (!onConfirm(endedAt)) refuse(t('dose.time.error'));
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View entering={entrance(motion, 0)} style={[StyleSheet.absoluteFill, { backgroundColor: alpha(color.bg, 0.8) }]} />
      <Animated.View
        accessibilityViewIsModal
        entering={entrance(motion, 8)}
        style={[styles.sheet, { backgroundColor: color.surface, borderColor: color.border }]}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('crisis.over.title')}
        </Text>
        <Text style={[styles.body, { color: color.text }]}>
          {t('crisis.over.body', {
            time: formatClock(endAt, locale),
            duration: formatDuration(minutesBetween(startedAt, endAt)),
          })}
        </Text>
        {changing ? (
          <TextField
            label={t('crisis.over.time')}
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setError(null);
            }}
            keyboardType="numbers-and-punctuation"
            autoFocus
            onSubmitEditing={confirm}
            {...(error === null ? {} : { error })}
          />
        ) : (
          <TextLink
            label={t('crisis.over.change_time')}
            onPress={() => {
              setChanging(true);
            }}
          />
        )}
        <View style={styles.actions}>
          <Button variant="secondary" size="crisis" label={t('crisis.over.not_yet')} style={styles.grow} onPress={onNotYet} />
          <Button testID="crisis-over-confirm" size="crisis" label={t('crisis.over.confirm')} style={styles.grow} onPress={confirm} />
        </View>
      </Animated.View>
    </View>
  );
}

interface EndedViewProps {
  episode: Episode;
  doses: readonly Dose[];
  medicationName: (id: string) => string;
  onFill: () => void;
  onClose: () => void;
}

/** What was recorded, with nothing that celebrates. */
export function EndedView({ episode, doses, medicationName, onFill, onClose }: EndedViewProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const ended = episode.endedAt === null ? new Date() : new Date(episode.endedAt);
  const rows = [
    { key: 'duration', label: t('crisis.ended.duration'), value: formatDuration(minutesBetween(new Date(episode.startedAt), ended)) },
    ...(episode.intensity === null ? [] : [{ key: 'intensity', label: t('crisis.intensity.label'), value: String(episode.intensity) }]),
    ...[...doses].reverse().map((dose) => ({
      key: dose.id,
      label: t('draft.k.dose'),
      value: t('today.attack.dose_v', { med: medicationName(dose.medicationId), time: formatClock(new Date(dose.takenAt), locale) }),
    })),
  ];

  return (
    <Animated.View testID="crisis-ended" entering={entrance(motion, 8)} style={styles.ended}>
      <View style={styles.endedBody}>
        <View style={styles.saved}>
          <Check size={20} color={color.text} />
          <Text style={[styles.strong, { color: color.text }]}>{t('crisis.saved_local')}</Text>
        </View>
        <Text accessibilityRole="header" style={[styles.display, { color: color.text }]}>
          {t('crisis.ended.title')}
        </Text>
        <View>
          {rows.map((row) => (
            <View key={row.key} style={[styles.row, { borderBottomColor: color.border }]}>
              <Text style={[styles.body, { color: color.textMuted }]}>{row.label}</Text>
              <Text style={[styles.rowValue, { color: color.text }]}>{row.value}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.actions}>
        <Button variant="secondary" size="crisis" label={t('crisis.ended.fill')} style={styles.grow} onPress={onFill} />
        <Button testID="crisis-ended-close" size="crisis" label={t('common.close')} style={styles.grow} onPress={onClose} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: space[3],
    padding: space[4],
    paddingBottom: space[5],
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
  ended: { flex: 1, gap: space[4] },
  endedBody: { flex: 1, justifyContent: 'center', gap: space[3] },
  saved: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowValue: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24, textAlign: 'right' },
});
