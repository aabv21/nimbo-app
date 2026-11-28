// The attacks grouped by month, newest first, under the search field and the Filters button.
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItem } from 'react-native';

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
  const rise = useMemo(() => entrance(motion, motion.level === 'subtle' ? 4 : 8), [motion]);

  // The screen hands a new filtered array each minute, so this rebuilds then too; the row memo is what spares the rows.
  const items = useMemo(() => {
    const list: Item[] = [];
    let group = '';
    for (const episode of episodes) {
      const started = new Date(episode.startedAt);
      const month = `${String(started.getFullYear())}-${String(started.getMonth())}`;
      if (month !== group) {
        group = month;
        list.push({ kind: 'month', key: `month-${month}`, label: monthTitle(started.getFullYear(), started.getMonth(), locale) });
      }
      list.push({ kind: 'episode', key: episode.id, episode });
    }
    return list;
  }, [episodes, locale]);

  const renderItem: ListRenderItem<Item> = useCallback(
    ({ item }) =>
      item.kind === 'month' ? (
        <Text accessibilityRole="header" style={[styles.month, { color: color.text }]}>
          {item.label}
        </Text>
      ) : (
        <EpisodeRow
          episode={item.episode}
          // Only an open attack counts up; an ended row keeps its props, so the memo skips it each minute.
          now={item.episode.endedAt === null ? now : null}
          onPress={onOpen}
          {...(initial.has(item.episode.id) ? {} : { entering: rise })}
        />
      ),
    [color.text, now, onOpen, initial, rise],
  );

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
      renderItem={renderItem}
    />
  );
}

const styles = StyleSheet.create({
  header: { gap: space[3], paddingBottom: space[2] },
  month: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24, paddingTop: space[3], paddingBottom: space[1] },
});
