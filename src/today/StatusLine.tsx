// Today's status: the sentence at the top, the open attack's card, and the 12-hour "is it over?" question.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import { packs } from '../condition';
import type { Episode } from '../episodes/episodeStore';
import { endEpisode } from '../episodes/episodeStore';
import { formatClock, formatDuration } from '../i18n/format';
import { useI18n } from '../i18n';
import { kvGet, kvSet } from '../lib/kv';
import { Button } from '../ui/Button';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const LONG_MS = packs.migraine.limits.longEpisodeHours * 60 * MINUTE_MS;

export type TodayStatus = { kind: 'first' } | { kind: 'running'; episode: Episode } | { kind: 'none'; lastEnd: Date | null };

/** Calendar days from `then` to `now` on the phone's clock: 0 today, 1 yesterday. */
export function daysBetween(then: Date, now: Date): number {
  const midnight = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  // Rounded, so a daylight-saving day of 23 or 25 hours still counts as one.
  return Math.round((midnight(now) - midnight(then)) / DAY_MS);
}

/** The most recent end among the user's attacks; null when none has ended. */
export function lastEnd(episodes: readonly Episode[]): Date | null {
  let latest: number | null = null;
  for (const episode of episodes) {
    if (episode.endedAt === null) continue;
    const ms = new Date(episode.endedAt).getTime();
    if (latest === null || ms > latest) latest = ms;
  }
  return latest === null ? null : new Date(latest);
}

export function StatusLine({ status, now }: { status: TodayStatus; now: Date }): React.JSX.Element {
  const { t, tp, locale } = useI18n();
  const { color } = useTheme();

  const [title, sub] = ((): [string, string | null] => {
    switch (status.kind) {
      case 'first':
        return [t('today.status.first'), t('today.status.first_sub')];
      case 'running': {
        const started = new Date(status.episode.startedAt);
        const minutes = (now.getTime() - started.getTime()) / MINUTE_MS;
        return [t('today.status.running'), t('today.status.since', { time: formatClock(started, locale), elapsed: formatDuration(minutes) })];
      }
      case 'none': {
        if (status.lastEnd === null) return [t('today.status.none'), null];
        const time = formatClock(status.lastEnd, locale);
        const days = daysBetween(status.lastEnd, now);
        if (days <= 0) return [t('today.status.none'), t('today.status.last_today', { time })];
        if (days === 1) return [t('today.status.none'), t('today.status.last', { time })];
        return [t('today.status.none'), tp('today.status.last_days', days)];
      }
    }
  })();

  return (
    <>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {title}
      </Text>
      {sub === null ? null : <Text style={[styles.small, { color: color.textMuted }]}>{sub}</Text>}
    </>
  );
}

/** The open attack's intensity and doses so far, read-only; crisis mode is where they change. */
export function AttackCard({ userId, episode }: { userId: string; episode: Episode }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const doses = useDoses(userId, { episodeId: episode.id });
  const medications = useMedications(userId, { includeArchived: true });
  const nameOf = new Map(medications.map((medication) => [medication.id, medication.name]));

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
        {t('today.attack.title')}
      </Text>
      {episode.intensity === null && doses.length === 0 ? null : (
        <View style={[styles.rows, { borderColor: color.border }]}>
          {episode.intensity === null ? null : (
            <View style={[styles.row, { borderColor: color.border }]}>
              <Text style={[styles.rowLabel, { color: color.text }]}>{t('crisis.intensity.label')}</Text>
              <Text style={[styles.intensity, { color: color.text }]}>{episode.intensity}</Text>
            </View>
          )}
          {/* Oldest first, as the attack went. */}
          {[...doses].reverse().map((dose) => (
            <View key={dose.id} style={[styles.row, { borderColor: color.border }]}>
              <Text style={[styles.rowLabel, { color: color.text }]}>{t('draft.k.dose')}</Text>
              <Text style={[styles.rowTrail, { color: color.textMuted }]}>
                {t('today.attack.dose_v', { med: nameOf.get(dose.medicationId) ?? '', time: formatClock(new Date(dose.takenAt), locale) })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function overKey(episodeId: string): string {
  return `today.over.${episodeId}`;
}

/**
 * From 12 hours on, asks once per 12-hour stretch whether the attack is over: "Yes" ends it now, "Not yet"
 * waits for the next multiple. The answer is kept per attack, so a relaunch does not ask again early.
 */
export function OverQuestion({ userId, episode, now }: { userId: string; episode: Episode; now: Date }): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const [dismissed, setDismissed] = useState(() => Number(kvGet(overKey(episode.id)) ?? '0'));
  const started = new Date(episode.startedAt);
  const stretch = Math.floor((now.getTime() - started.getTime()) / LONG_MS);
  if (stretch < 1 || stretch <= dismissed) return null;

  const minutes = (now.getTime() - started.getTime()) / MINUTE_MS;
  return (
    <View accessibilityRole="summary" style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
      <Text style={[styles.cardTitle, { color: color.text }]}>{t('crisis.over.title')}</Text>
      <Text style={[styles.small, { color: color.text }]}>
        {t('crisis.over.body', { time: formatClock(now, locale), duration: formatDuration(minutes) })}
      </Text>
      <View style={styles.actions}>
        <Button
          variant="secondary"
          label={t('crisis.over.not_yet')}
          onPress={() => {
            kvSet(overKey(episode.id), String(stretch));
            setDismissed(stretch);
          }}
          style={styles.action}
        />
        <Button
          label={t('crisis.over.confirm')}
          onPress={() => {
            endEpisode(userId, episode.id, new Date());
          }}
          style={styles.action}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  rows: { borderTopWidth: 1 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[1],
    minHeight: controlHeight + space[1],
    paddingVertical: space[2],
    borderBottomWidth: 1,
  },
  rowLabel: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  rowTrail: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.label, lineHeight: 20, textAlign: 'right' },
  intensity: { fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27 },
  card: { gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  action: { flexGrow: 1, flexBasis: 140 },
});
