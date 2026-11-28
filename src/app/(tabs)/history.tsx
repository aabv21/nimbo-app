// Calendar and list of the attacks on this phone. "Patterns" joins the switch with the insights.
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../../auth/AuthProvider';
import { useDoses } from '../../cabinet/doseStore';
import { useMinuteClock } from '../../crisis/useMinuteClock';
import { useEpisodes } from '../../episodes/episodeStore';
import { EMPTY_FILTER, filterEpisodes } from '../../history/filterEpisodes';
import type { EpisodeFilter } from '../../history/filterEpisodes';
import { FilterSheet } from '../../history/FilterSheet';
import { HistoryCalendar } from '../../history/HistoryCalendar';
import { HistoryList } from '../../history/HistoryList';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { Screen } from '../../ui/Screen';
import { useTabBarInset } from '../../ui/TabBar';
import { TextLink } from '../../ui/TextLink';
import { controlHeight, fonts, radius, space, type } from '../../ui/theme';
import { useTheme, useTones } from '../../ui/themeContext';
import { usePressFeedback } from '../../ui/usePressFeedback';

type ViewName = 'calendar' | 'list';

const VIEWS: readonly { name: ViewName; label: MessageKey }[] = [
  { name: 'calendar', label: 'history.view.calendar' },
  { name: 'list', label: 'history.view.list' },
];
// The overuse notice's action: the attacks that had a dose this month, near enough as the last 30 days.
const DOSES_FILTER: EpisodeFilter = { ...EMPTY_FILTER, doses: 'with', period: '30d' };

function Segment({ name, label, selected, onPress }: { name: ViewName; label: string; selected: boolean; onPress: () => void }): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={[styles.segmentFrame, scaleStyle]}>
      <Pressable
        testID={`history-view-${name}`}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.segment, selected && { backgroundColor: tones.opaquePill }]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Text style={[styles.segmentLabel, { color: selected ? color.text : color.textMuted }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function HistoryBody({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const bottomInset = useTabBarInset();
  const now = useMinuteClock();
  const episodes = useEpisodes(userId);
  const doses = useDoses(userId);

  const { filter: param } = useLocalSearchParams<{ filter?: string }>();
  const fromOveruse = param === 'doses';
  const [view, setView] = useState<ViewName>(fromOveruse ? 'list' : 'calendar');
  const [filter, setFilter] = useState<EpisodeFilter>(fromOveruse ? DOSES_FILTER : EMPTY_FILTER);
  const [seenOveruse, setSeenOveruse] = useState(fromOveruse);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The tab can already be mounted when the action is pressed, so a new param is applied during render.
  if (fromOveruse !== seenOveruse) {
    setSeenOveruse(fromOveruse);
    if (fromOveruse) {
      setView('list');
      setFilter(DOSES_FILTER);
    }
  }

  const shown = useMemo(
    () => filterEpisodes(episodes, doses, filter, now, (key) => t(key as MessageKey)),
    [episodes, doses, filter, now, t],
  );
  const open = (id: string): void => {
    router.push({ pathname: '/episode/[id]', params: { id } });
  };

  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.display, { color: color.text }]}>
        {t('history.title')}
      </Text>
      <View accessibilityRole="tablist" accessibilityLabel={t('history.views')} style={[styles.switch, { borderColor: color.border }]}>
        {VIEWS.map(({ name, label }) => (
          <Segment key={name} name={name} label={t(label)} selected={view === name} onPress={() => { setView(name); }} />
        ))}
      </View>
    </View>
  );
  const emptyText = (
    <View style={styles.empty}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('history.empty.title')}
      </Text>
      <Text style={[styles.body, { color: color.text }]}>{t('history.empty.body')}</Text>
    </View>
  );

  return (
    <>
      {view === 'calendar' ? (
        <Screen bottomInset={bottomInset}>
          {header}
          <HistoryCalendar userId={userId} episodes={episodes} now={now} onOpen={open} />
          {episodes.length === 0 ? emptyText : null}
        </Screen>
      ) : (
        <Screen scroll={false}>
          <HistoryList
            episodes={shown}
            now={now}
            header={header}
            empty={
              episodes.length === 0 ? (
                emptyText
              ) : (
                <TextLink label={t('history.filter.clear')} onPress={() => { setFilter(EMPTY_FILTER); }} />
              )
            }
            query={filter.query}
            onQuery={(query) => { setFilter((current) => ({ ...current, query })); }}
            onOpenFilters={() => { setSheetOpen(true); }}
            onOpen={open}
            bottomPadding={bottomInset}
          />
        </Screen>
      )}
      {sheetOpen ? (
        <FilterSheet
          episodes={episodes}
          doses={doses}
          filter={filter}
          now={now}
          onApply={setFilter}
          onClosed={() => { setSheetOpen(false); }}
        />
      ) : null}
    </>
  );
}

export default function History(): React.JSX.Element | null {
  const { userId } = useAuth();
  return userId === null ? null : <HistoryBody userId={userId} />;
}

const styles = StyleSheet.create({
  header: { gap: space[3] },
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  switch: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.control, padding: space[0], gap: space[0] },
  segmentFrame: { flex: 1 },
  segment: { minHeight: controlHeight, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - 2, overflow: 'hidden' },
  segmentLabel: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  empty: { gap: space[3], paddingTop: space[2] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
