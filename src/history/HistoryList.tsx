// The attacks grouped by month, newest first, under the search field and the Filters button.
import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import type { Episode } from '../episodes/episodeStore';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { entrance, useMotion } from '../ui/motion';
import { TextField } from '../ui/TextField';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { monthTitle } from './dateLabels';
import { EpisodeRow } from './EpisodeRow';

type Item = { kind: 'month'; key: string; label: string } | { kind: 'episode'; key: string; episode: Episode };

interface HistoryListProps {
  episodes: readonly Episode[];
  now: Date;
  /** The screen's title and view switch, scrolled with the list. */
  header: React.ReactElement;
  /** Shown when nothing is left to list. */
  empty: React.ReactElement;
  query: string;
  onQuery: (query: string) => void;
  onOpenFilters: () => void;
  onOpen: (id: string) => void;
  /** Below the last row, clear of the tab bar. */
  bottomPadding: number;
}

export function HistoryList({ episodes, now, header, empty, query, onQuery, onOpenFilters, onOpen, bottomPadding }: HistoryListProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  // Rows already there when the list first showed do not animate; one that arrives later rises in.
  const [initial] = useState(() => new Set(episodes.map((episode) => episode.id)));

  const items: Item[] = [];
  let group = '';
  for (const episode of episodes) {
    const started = new Date(episode.startedAt);
    const month = `${String(started.getFullYear())}-${String(started.getMonth())}`;
    if (month !== group) {
      group = month;
      items.push({ kind: 'month', key: `month-${month}`, label: monthTitle(started.getFullYear(), started.getMonth(), locale) });
    }
    items.push({ kind: 'episode', key: episode.id, episode });
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ paddingBottom: bottomPadding }}
      ListHeaderComponent={
        <View style={styles.header}>
          {header}
          <TextField
            label={t('history.search.label')}
            value={query}
            onChangeText={onQuery}
            placeholder={t('history.search.ph')}
            returnKeyType="search"
            autoCorrect={false}
          />
          <Button variant="secondary" label={t('history.filters')} onPress={onOpenFilters} />
        </View>
      }
      ListEmptyComponent={empty}
      renderItem={({ item }) =>
        item.kind === 'month' ? (
          <Text accessibilityRole="header" style={[styles.month, { color: color.text }]}>
            {item.label}
          </Text>
        ) : (
          <EpisodeRow
            episode={item.episode}
            now={now}
            onPress={onOpen}
            {...(initial.has(item.episode.id) ? {} : { entering: entrance(motion, motion.level === 'subtle' ? 4 : 8) })}
          />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: space[3], paddingBottom: space[2] },
  month: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24, paddingTop: space[3], paddingBottom: space[1] },
});
