// One attack in a list: its day, its times and intensity, then the main tags. The whole row is the press target.
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { EntryOrExitLayoutType } from 'react-native-reanimated';

import type { Episode } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import { formatClock, formatDuration } from '../i18n/format';
import { controlHeight, fonts, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { dayTitle } from './dateLabels';
import { catalogLabelKey } from './labels';

const MINUTE_MS = 60 * 1000;
const MAX_TAGS = 3;

interface EpisodeRowProps {
  episode: Episode;
  /** An attack still open counts up to here; null for an ended one, so the minute tick leaves its row alone. */
  now: Date | null;
  onPress: (id: string) => void;
  /** Only for a row that arrived after the list was first shown. */
  entering?: EntryOrExitLayoutType;
}

/** Memoized: a list re-renders each minute, and only an open attack's row has anything new to show. */
export const EpisodeRow = memo(function EpisodeRow({ episode, now, onPress, entering }: EpisodeRowProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  const start = new Date(episode.startedAt);
  const end = episode.endedAt === null ? null : new Date(episode.endedAt);
  const time = end === null ? formatClock(start, locale) : `${formatClock(start, locale)}–${formatClock(end, locale)}`;
  const duration = formatDuration(Math.floor(((end ?? now ?? start).getTime() - start.getTime()) / MINUTE_MS));
  const sub =
    episode.intensity === null
      ? `${time}, ${duration}`
      : t('history.row.sub', { time, duration, intensity: episode.intensity });
  const tags = [
    ...episode.triggers.map((key) => catalogLabelKey('triggers', key)),
    ...episode.symptoms.map((key) => catalogLabelKey('symptoms', key)),
  ]
    .flatMap((key) => (key === null ? [] : [t(key)]))
    .slice(0, MAX_TAGS)
    .join(', ');

  return (
    <Animated.View {...(entering === undefined ? {} : { entering })} style={scaleStyle}>
      <Pressable
        testID={`episode-row-${episode.id}`}
        accessibilityRole="button"
        onPress={() => {
          onPress(episode.id);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.row, { borderBottomColor: color.border }]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <View style={styles.main}>
          <Text style={[styles.title, { color: color.text }]}>{dayTitle(start, locale)}</Text>
          <Text style={[styles.sub, { color: color.textMuted }]}>{sub}</Text>
          {tags === '' ? null : <Text style={[styles.sub, { color: color.textMuted }]}>{tags}</Text>}
        </View>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: { minHeight: controlHeight + space[2], justifyContent: 'center', paddingVertical: space[1], borderBottomWidth: StyleSheet.hairlineWidth },
  main: { gap: 2 },
  title: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
});
