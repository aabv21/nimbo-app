// The month as a grid: an attack day carries its highest intensity as a number, a check-in day a dot.
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useDoses } from '../cabinet/doseStore';
import { useCheckinDates } from '../checkin/checkinStore';
import type { Episode } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { localDate } from '../lib/localDate';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { dayTitle, monthTitle } from './dateLabels';
import { EpisodeRow } from './EpisodeRow';
import { monthGrid } from './monthGrid';

const WEEKDAYS: readonly MessageKey[] = [
  'history.dow.mon',
  'history.dow.tue',
  'history.dow.wed',
  'history.dow.thu',
  'history.dow.fri',
  'history.dow.sat',
  'history.dow.sun',
];

interface HistoryCalendarProps {
  userId: string;
  episodes: readonly Episode[];
  now: Date;
  onOpen: (id: string) => void;
}

interface DayCellProps {
  day: number;
  label: string;
  /** The highest intensity of the day's attacks; null when none was rated. */
  intensity: number | null;
  attack: boolean;
  checkin: boolean;
  today: boolean;
  future: boolean;
  selected: boolean;
  onPress: () => void;
}

function DayCell({ day, label, intensity, attack, checkin, today, future, selected, onPress }: DayCellProps): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const body = (
    <>
      <Text style={[styles.dayNumber, { color: future ? color.textMuted : color.text }]}>{day}</Text>
      <View style={styles.marks}>
        {checkin ? <View testID="checkin-dot" style={[styles.dot, { backgroundColor: color.accent }]} /> : null}
        {intensity === null ? null : <Text style={[styles.intensity, { color: color.text }]}>{intensity}</Text>}
      </View>
    </>
  );
  const frame = [
    styles.cell,
    { borderColor: today ? color.accent : 'transparent' },
    (attack || selected) && { backgroundColor: tones.opaquePill },
    selected && { borderColor: color.accent },
  ];
  // Only an attack day does anything when pressed, so only it is a button.
  return attack ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={frame}>
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={label} style={frame}>
      {body}
    </View>
  );
}

export function HistoryCalendar({ userId, episodes, now, onOpen }: HistoryCalendarProps): React.JSX.Element {
  const { t, tp, locale } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const [shown, setShown] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [selected, setSelected] = useState<number | null>(null);
  const { year, month } = shown;
  const lastDay = new Date(year, month + 1, 0).getDate();

  const doses = useDoses(userId);
  const checkinDays = useCheckinDates(userId, localDate(new Date(year, month, 1)), localDate(new Date(year, month, lastDay)));

  const inMonth = (date: Date): boolean => date.getFullYear() === year && date.getMonth() === month;
  const byDay = new Map<number, Episode[]>();
  for (const episode of episodes) {
    const started = new Date(episode.startedAt);
    if (inMonth(started)) byDay.set(started.getDate(), [...(byDay.get(started.getDate()) ?? []), episode]);
  }
  const attacks = [...byDay.values()].reduce((total, list) => total + list.length, 0);
  const doseDays = new Set(doses.map((dose) => new Date(dose.takenAt)).filter(inMonth).map((date) => date.getDate())).size;

  const atCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const move = (by: -1 | 1): void => {
    setShown(({ year: y, month: m }) => {
      const next = new Date(y, m + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
    setSelected(null);
  };
  const dayEpisodes = selected === null ? [] : (byDay.get(selected) ?? []);

  return (
    <View style={styles.root}>
      <View style={styles.monthBar}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('history.prev')} onPress={() => { move(-1); }} style={styles.arrow}>
          <ChevronLeft size={28} color={color.text} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.month, { color: color.text }]}>
          {monthTitle(year, month, locale)}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('history.next')}
          accessibilityState={{ disabled: atCurrentMonth }}
          disabled={atCurrentMonth}
          onPress={() => { move(1); }}
          style={styles.arrow}
        >
          <ChevronRight size={28} color={atCurrentMonth ? color.textMuted : color.text} />
        </Pressable>
      </View>

      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.week}>
        {WEEKDAYS.map((key) => (
          <Text key={key} style={[styles.weekday, { color: color.textMuted }]}>
            {t(key)}
          </Text>
        ))}
      </View>
      {monthGrid(year, month).map((week) => (
        <View key={week.map((day) => day ?? 'x').join('-')} style={styles.week}>
          {week.map((day, slot) => {
            if (day === null) return <View key={`blank-${String(slot)}`} style={styles.cell} />;
            const date = new Date(year, month, day);
            const list = byDay.get(day) ?? [];
            const ratings = list.flatMap((episode) => (episode.intensity === null ? [] : [episode.intensity]));
            const intensity = ratings.length === 0 ? null : Math.max(...ratings);
            const checkin = checkinDays.has(localDate(date));
            const label = [
              dayTitle(date, locale),
              ...(intensity === null ? [] : [`${t('crisis.intensity.label')} ${String(intensity)}`]),
              ...(checkin ? [t('history.legend.checkin')] : []),
            ].join(', ');
            return (
              <DayCell
                key={day}
                day={day}
                label={label}
                intensity={intensity}
                attack={list.length > 0}
                checkin={checkin}
                today={atCurrentMonth && day === now.getDate()}
                future={date.getTime() > now.getTime()}
                selected={selected === day}
                onPress={() => { setSelected(selected === day ? null : day); }}
              />
            );
          })}
        </View>
      ))}

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: tones.opaquePill, borderColor: color.border }]} />
          <Text style={[styles.caption, { color: color.textMuted }]}>{t('history.legend.attack')}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: color.accent }]} />
          <Text style={[styles.caption, { color: color.textMuted }]}>{t('history.legend.checkin')}</Text>
        </View>
      </View>
      <Text style={[styles.summary, { color: color.textMuted }]}>
        {tp('history.month.summary', attacks, { days: tp('history.month.dose_days', doseDays) })}
      </Text>

      {dayEpisodes.map((episode) => (
        <EpisodeRow key={episode.id} episode={episode} now={now} onPress={onOpen} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: space[1] },
  monthBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { minWidth: controlHeight, minHeight: controlHeight, alignItems: 'center', justifyContent: 'center' },
  month: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  week: { flexDirection: 'row', gap: space[0] },
  weekday: { flex: 1, textAlign: 'center', fontFamily: fonts.bodySemiBold, fontSize: type.caption, lineHeight: 18 },
  cell: {
    flex: 1,
    minHeight: controlHeight + space[1],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 2,
  },
  dayNumber: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  marks: { flexDirection: 'row', alignItems: 'center', gap: space[0], minHeight: 16 },
  intensity: { fontFamily: fonts.bodyBold, fontSize: type.caption, lineHeight: 16 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], paddingTop: space[1] },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 1 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  summary: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20, paddingBottom: space[1] },
});
