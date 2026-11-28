// One acute medication in crisis mode: log a dose now, then the countdown from the interval the user entered.
import * as Haptics from 'expo-haptics';
import { Pill } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { deleteDose, logDose, useDoses } from '../cabinet/doseStore';
import type { Medication } from '../cabinet/medicationStore';
import { formatClock, formatDuration, parseClock } from '../i18n/format';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { crossFade, entrance, useMotion } from '../ui/motion';
import { TextField } from '../ui/TextField';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { minutesLeft, nextDoseAt, resolveDoseTime } from './countdown';

/** "21:05": what the time field takes back, whatever the locale shows. */
function clockText(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

interface DoseButtonProps {
  userId: string;
  episodeId: string;
  medication: Medication;
  /** The minute clock the whole screen shares. */
  now: Date;
  timeZone: string;
  /** "What helped before" repeats a medication from Doses, so its Maestro ids differ: `dose-helped-log`, `dose-helped-change`. */
  inPlan?: boolean;
}

export function DoseButton({ userId, episodeId, medication, now, timeZone, inPlan = false }: DoseButtonProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const fade = crossFade(motion);
  const doses = useDoses(userId, { medicationId: medication.id });
  // Logged from this screen: only those can be moved or taken back here.
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(false);
  const hours = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }), [locale]);

  const inEpisode = doses.find((dose) => dose.episodeId === episodeId) ?? null;
  // The countdown follows the latest dose of this medication, whichever attack it was logged in.
  const latest = doses[0] ?? null;
  const next = nextDoseAt(latest === null ? null : new Date(latest.takenAt), medication.minIntervalMinutes);
  const left = next === null ? 0 : minutesLeft(next, now);
  const status =
    inEpisode === null ? t('crisis.dose.none_yet') : t('crisis.dose.taken', { time: formatClock(new Date(inEpisode.takenAt), locale) });
  const undoable = justLogged !== null && doses.some((dose) => dose.id === justLogged);

  const log = (takenAt: Date): void => {
    setJustLogged(logDose(userId, { medicationId: medication.id, takenAt, episodeId }));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };
  const takeBack = (): void => {
    if (justLogged === null) return;
    deleteDose(userId, justLogged);
    setJustLogged(null);
    setEditing(false);
  };
  const saveTime = (): void => {
    const clock = parseClock(typed);
    if (clock === null || justLogged === null) {
      setError(true);
      return;
    }
    // Two transactions: logging the moved dose first means a kill in between leaves a duplicate to delete,
    // never a missing dose that would let the countdown allow an early one.
    const replaced = justLogged;
    log(resolveDoseTime(clock, new Date(), timeZone));
    deleteDose(userId, replaced);
    setEditing(false);
    setError(false);
  };

  return (
    <View style={[styles.card, { borderColor: color.border }]}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: color.text }]}>{medication.name}</Text>
        <Animated.Text key={status} entering={fade.entering} exiting={fade.exiting} style={[styles.small, { color: color.textMuted }]}>
          {status}
        </Animated.Text>
      </View>

      {medication.minIntervalMinutes === null ? (
        <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.dose.no_interval')}</Text>
      ) : next !== null && left > 0 ? (
        <Animated.View entering={entrance(motion, 4)} accessibilityRole="timer" style={styles.countdown}>
          <Animated.Text key={left} entering={fade.entering} exiting={fade.exiting} style={[styles.left, { color: color.text }]}>
            {t('crisis.dose.left', { left: formatDuration(left) })}
          </Animated.Text>
          <Text style={[styles.strong, { color: color.text }]}>{t('crisis.dose.next', { time: formatClock(next, locale) })}</Text>
          <Text style={[styles.caption, { color: color.textMuted }]}>
            {t('crisis.dose.interval', { hours: hours.format(medication.minIntervalMinutes / 60) })}
          </Text>
        </Animated.View>
      ) : null}

      {undoable && editing ? (
        <View style={styles.edit}>
          <TextField
            label={t('dose.time')}
            value={typed}
            onChangeText={(text) => {
              setTyped(text);
              setError(false);
            }}
            keyboardType="numbers-and-punctuation"
            autoFocus
            onSubmitEditing={saveTime}
            {...(error ? { error: t('dose.time.error') } : {})}
          />
          <View style={styles.actions}>
            <Button
              variant="secondary"
              size="crisis"
              label={t('common.cancel')}
              style={styles.grow}
              onPress={() => {
                setEditing(false);
                setError(false);
              }}
            />
            <Button size="crisis" label={t('common.save')} style={styles.grow} onPress={saveTime} />
          </View>
        </View>
      ) : null}
      {undoable && !editing ? (
        <View style={styles.actions}>
          <Button
            testID={`dose-${inPlan ? 'helped-' : ''}change`}
            variant="secondary"
            size="crisis"
            label={t('common.change')}
            style={styles.grow}
            onPress={() => {
              const taken = doses.find((dose) => dose.id === justLogged);
              setTyped(taken === undefined ? '' : clockText(new Date(taken.takenAt)));
              setEditing(true);
            }}
          />
          <Button variant="secondary" size="crisis" label={t('common.cancel')} style={styles.grow} onPress={takeBack} />
        </View>
      ) : null}

      {editing && undoable ? null : (
        <Button
          testID={`dose-${inPlan ? 'helped-' : ''}log`}
          variant="secondary"
          size="crisis"
          icon={Pill}
          label={t('crisis.dose.log')}
          accessibilityLabel={`${t('crisis.dose.log')}, ${medication.name}`}
          onPress={() => {
            log(new Date());
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  head: { gap: space[0] },
  name: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  countdown: { gap: space[0] },
  left: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  edit: { gap: space[2] },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
