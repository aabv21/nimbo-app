// Today: where the user stands now, then signals, medication and the check-in in the order that matters to them,
// with the start of an attack docked above the tabs. Everything reads the phone's local store.
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { CheckinCard } from '../../checkin/CheckinCard';
import { isCheckinDone, useCheckin, useCheckinDates } from '../../checkin/checkinStore';
import { useMinuteClock } from '../../crisis/useMinuteClock';
import { startEpisode, useEpisodes, useOpenEpisode } from '../../episodes/episodeStore';
import { useI18n } from '../../i18n';
import { localDate } from '../../lib/localDate';
import { SyncNotice } from '../../lib/sync/SyncNotice';
import { MedicationSummary, useMedicationMonth } from '../../today/MedicationSummary';
import { AttackCard, OverQuestion, StatusLine, lastEnd } from '../../today/StatusLine';
import type { TodayStatus } from '../../today/StatusLine';
import { todaySections } from '../../today/todaySections';
import type { TodaySection } from '../../today/todaySections';
import { Button } from '../../ui/Button';
import { DockedScreen } from '../../ui/DockedScreen';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

// The device's zone: doses count by the calendar the user lives by, as on the cabinet.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
// Every check-in date there could be, to tell whether anything was ever logged.
const EVER: readonly [string, string] = ['0000-01-01', '9999-12-31'];

function openCrisis(id: string): void {
  router.push({ pathname: '/crisis', params: { id } });
}

export default function Today(): React.JSX.Element | null {
  const { userId } = useAuth();
  // The tabs mount only for a signed-in user; this keeps the types honest.
  if (userId === null) return null;
  return <TodayScreen userId={userId} />;
}

function TodayScreen({ userId }: { userId: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { profile } = useAuth();
  const tabInset = useTabBarInset();
  // Ticks each minute and on every return to the app, so the date turns over at midnight and after a night away.
  const now = useMinuteClock();
  const day = localDate(now);
  // Keyed on the day rather than the minute, so the text is rebuilt only when the date turns over.
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00`)),
    [locale, day],
  );

  const episodes = useEpisodes(userId);
  const open = useOpenEpisode(userId);
  const checkin = useCheckin(userId, day);
  const anyCheckin = useCheckinDates(userId, EVER[0], EVER[1]).size > 0;
  const month = useMedicationMonth(userId, now, TIME_ZONE);

  const status: TodayStatus =
    open !== null
      ? { kind: 'running', episode: open }
      : episodes.length === 0 && !anyCheckin && !month.anyDose
        ? { kind: 'first' }
        : { kind: 'none', lastEnd: lastEnd(episodes) };

  const order = todaySections({ priority: profile?.priority ?? null, overuseLevel: month.level, checkinDone: isCheckinDone(checkin) });
  const renderSection = (section: TodaySection): React.JSX.Element => {
    switch (section) {
      case 'signals':
        return (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
              {t('today.signals.title')}
            </Text>
            <Text style={[styles.small, { color: color.textMuted }]}>{t('today.signals.empty')}</Text>
          </View>
        );
      case 'medication':
        return <MedicationSummary month={month} />;
      case 'checkin':
        return <CheckinCard userId={userId} localDate={day} />;
    }
  };

  const dock =
    open === null ? (
      <Button
        label={t('today.start')}
        onPress={() => {
          // Written before the push, so crisis mode opens on a saved attack even if the app dies right after.
          openCrisis(startEpisode(userId));
        }}
      />
    ) : (
      <Button
        label={t('today.resume')}
        onPress={() => {
          openCrisis(open.id);
        }}
      />
    );

  return (
    <DockedScreen above={tabInset} dock={dock}>
      <View style={styles.head}>
        <Text style={[styles.small, { color: color.textMuted }]}>{date}</Text>
        <StatusLine status={status} now={now} />
      </View>
      <SyncNotice />
      {open === null ? null : <OverQuestion key={open.id} userId={userId} episode={open} now={now} />}
      {profile?.aiEnabled === false ? (
        <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>{t('today.summary.ai_off')}</Text>
        </View>
      ) : null}
      {open === null ? null : <AttackCard userId={userId} episode={open} />}
      {/* A new order snaps into place: no layout animation. */}
      {order.map((section) => (
        <View key={section}>{renderSection(section)}</View>
      ))}
    </DockedScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[1] },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  card: { padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
