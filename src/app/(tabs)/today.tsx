// Today: where the user stands now, then signals, medication and the check-in in the order that matters to them,
// with the start of an attack docked above the tabs. Everything reads the phone's local store but today's pressure row.
import { router } from 'expo-router';
import { useMemo, useRef } from 'react';
import type { ComponentRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { ScrollView } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { CheckinCard } from '../../checkin/CheckinCard';
import { isCheckinDone, useCheckin, useCheckinDates } from '../../checkin/checkinStore';
import { useMinuteClock } from '../../crisis/useMinuteClock';
import { startEpisode, useEpisodes, useOpenEpisode } from '../../episodes/episodeStore';
import { useI18n } from '../../i18n';
import { deviceTimeZone, localDate } from '../../lib/localDate';
import { useOncePerFocus } from '../../lib/useOncePerFocus';
import { SyncNotice } from '../../lib/sync/SyncNotice';
import { CompanionNoteCard } from '../../signals/CompanionNoteCard';
import { companionNote } from '../../signals/companionNote';
import type { Signal } from '../../signals';
import type { SignalActionKind } from '../../signals/signalText';
import { SignalsSection } from '../../signals/SignalsSection';
import { useTodaySignals } from '../../signals/useTodaySignals';
import { MedicationSummary, useMedicationMonth } from '../../today/MedicationSummary';
import { AttackCard, OverQuestion, StatusLine, lastEnd } from '../../today/StatusLine';
import type { TodayStatus } from '../../today/StatusLine';
import { todaySections } from '../../today/todaySections';
import type { TodaySection } from '../../today/todaySections';
import { Button } from '../../ui/Button';
import { DockedScreen } from '../../ui/DockedScreen';
import { useMotion } from '../../ui/motion';
import { useTabBarInset } from '../../ui/TabBar';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

// The device's zone: doses count by the calendar the user lives by, as on the cabinet.
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
  const motion = useMotion();
  // A second tap before crisis mode covers Today would open it twice (and fade twice).
  const once = useOncePerFocus();
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
  const month = useMedicationMonth(userId, now, deviceTimeZone());
  const signals = useTodaySignals(userId, now);
  const aiOn = profile?.aiEnabled === true;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const checkinRef = useRef<ComponentRef<typeof Text>>(null);
  const checkinY = useRef(0);

  const status: TodayStatus =
    open !== null
      ? { kind: 'running', episode: open }
      : episodes.length === 0 && !anyCheckin && !month.anyDose
        ? { kind: 'first' }
        : { kind: 'none', lastEnd: lastEnd(episodes) };

  const note = companionNote({ openEpisode: open !== null, rows: signals.rows, hasRecords: status.kind !== 'first' });

  const onSignalAction = (signal: Signal, kind: SignalActionKind): void => {
    if (kind === 'checkin') {
      // Reduced motion jumps rather than scrolls.
      scrollRef.current?.scrollTo({ y: checkinY.current, animated: motion.level !== 'fade' });
      if (checkinRef.current !== null) AccessibilityInfo.sendAccessibilityEvent(checkinRef.current, 'focus');
      return;
    }
    once(() => {
      switch (kind) {
        case 'debrief': {
          const id = signal.kind === 'debrief_due' ? signal.evidence.episodeId : null;
          if (id === null) return;
          // The route carries the attack's id only; the chat asks its questions.
          if (aiOn) router.push({ pathname: '/companion', params: { debrief: id } });
          else router.push({ pathname: '/episode/[id]', params: { id } });
          return;
        }
        case 'crisis': {
          const id = open?.id ?? (signal.kind === 'long_attack' ? signal.evidence.episodeId : null);
          if (id !== null) openCrisis(id);
          return;
        }
        case 'cabinet':
          router.push('/cabinet');
          return;
      }
    });
  };

  const order = todaySections({ priority: profile?.priority ?? null, overuseLevel: month.level, checkinDone: isCheckinDone(checkin) });
  const renderSection = (section: TodaySection): React.JSX.Element => {
    switch (section) {
      case 'signals':
        return (
          <SignalsSection
            rows={signals.rows}
            empty={signals.empty}
            knownTriggers={profile?.knownTriggers ?? []}
            timeZone={signals.timeZone}
            onAction={onSignalAction}
          />
        );
      case 'medication':
        return <MedicationSummary month={month} />;
      case 'checkin':
        return <CheckinCard userId={userId} localDate={day} headingRef={checkinRef} />;
    }
  };

  const dock =
    open === null ? (
      <Button
        testID="today-start-attack"
        label={t('today.start')}
        onPress={() => {
          // Written before the push, so crisis mode opens on a saved attack even if the app dies right after.
          once(() => {
            openCrisis(startEpisode(userId));
          });
        }}
      />
    ) : (
      <Button
        label={t('today.resume')}
        onPress={() => {
          once(() => {
            openCrisis(open.id);
          });
        }}
      />
    );

  return (
    <DockedScreen above={tabInset} dock={dock} scrollRef={scrollRef}>
      <View style={styles.head}>
        <Text style={[styles.small, { color: color.textMuted }]}>{date}</Text>
        <StatusLine status={status} now={now} />
      </View>
      <SyncNotice />
      {open === null ? null : <OverQuestion key={open.id} userId={userId} episode={open} now={now} />}
      {note === null ? null : (
        <CompanionNoteCard
          state={note}
          now={now}
          timeZone={signals.timeZone}
          onReply={
            aiOn
              ? () => {
                  once(() => {
                    router.push('/companion');
                  });
                }
              : null
          }
        />
      )}
      {profile?.aiEnabled === false ? (
        <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>{t('today.summary.ai_off')}</Text>
        </View>
      ) : null}
      {open === null ? null : <AttackCard userId={userId} episode={open} />}
      {/* A new order snaps into place: no layout animation. */}
      {order.map((section) => (
        <View
          key={section}
          onLayout={
            section === 'checkin'
              ? (event) => {
                  checkinY.current = event.nativeEvent.layout.y;
                }
              : undefined
          }
        >
          {renderSection(section)}
        </View>
      ))}
    </DockedScreen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space[1] },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  card: { padding: space[3], borderRadius: radius.card, borderWidth: 1 },
});
