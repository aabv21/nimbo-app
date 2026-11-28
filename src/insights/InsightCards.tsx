// History's Patterns: one section per insight kind in pack order, each either its counts or what it still needs.
import { useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { localDateIn, packs } from '../condition';
import { useI18n } from '../i18n';
import { entrance, useMotion } from '../ui/motion';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { computeInsights, INSIGHT_KINDS, insightNeeds } from './index';
import type { Insight, InsightData, InsightKind } from './index';
import { cardLines } from './insightText';
import type { Bar, InsightLines, InsightTextContext } from './insightText';
import { NeedCard, sectionStyle } from './NeedCard';

const pack = packs.migraine;
// Months, parts of the day and weekdays read best as columns; named entries as rows.
const COLUMN_KINDS: ReadonlySet<InsightKind> = new Set(['monthly_frequency', 'time_of_day', 'weekday']);
const COLUMN_HEIGHT = 96;
/** From this text size up, twelve month labels no longer fit as columns: the same bars read as rows that wrap. */
const ROWS_FROM_FONT_SCALE = 1.3;

function Columns({ bars }: { bars: readonly Bar[] }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.columns}>
      {bars.map((bar) => (
        <View key={bar.label} style={styles.column}>
          <Text style={[styles.columnValue, { color: color.text }]}>{bar.value}</Text>
          <View style={[styles.columnBar, { height: Math.max(2, Math.round(bar.fraction * COLUMN_HEIGHT)), backgroundColor: color.accent }]} />
          <Text numberOfLines={2} style={[styles.columnLabel, { color: color.textMuted, borderTopColor: color.textMuted }]}>
            {bar.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Rows({ bars }: { bars: readonly Bar[] }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.rows}>
      {bars.map((bar) => (
        <View key={bar.label} style={styles.row}>
          <View style={styles.rowTop}>
            <Text style={[styles.label, { color: color.text }]}>{bar.label}</Text>
            <Text style={[styles.label, { color: color.textMuted }]}>{bar.value}</Text>
          </View>
          <View style={[styles.meter, { backgroundColor: color.border }]}>
            <View style={[styles.meterFill, { width: `${String(Math.round(bar.fraction * 100))}%`, backgroundColor: color.accent }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function InsightCard({ kind, lines }: { kind: InsightKind; lines: InsightLines }): React.JSX.Element {
  const { color } = useTheme();
  const { fontScale } = useWindowDimensions();
  const barCount = lines.bars.length;
  const columns = COLUMN_KINDS.has(kind) && fontScale < ROWS_FROM_FONT_SCALE;
  return (
    <View testID={`insight-card-${kind}`} style={[styles.section, { borderTopColor: color.border }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {lines.title}
      </Text>
      {lines.figure === null ? null : (
        // The sentence under it says the same number, so a screen reader hears it once.
        <Text testID={`insight-figure-${kind}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.figure, { color: color.text }]}>
          {lines.figure}
        </Text>
      )}
      {barCount === 0 ? null : (
        // The bars are read as their lines, so a screen reader hears label and count together.
        <View accessible accessibilityLabel={lines.rows.slice(0, barCount).join('. ')}>
          {columns ? <Columns bars={lines.bars} /> : <Rows bars={lines.bars} />}
        </View>
      )}
      {lines.rows.slice(barCount).map((row) => (
        <Text key={row} style={[styles.body, { color: color.text }]}>
          {row}
        </Text>
      ))}
      {lines.read === null ? null : <Text style={[styles.small, { color: color.text }]}>{lines.read}</Text>}
      {lines.note === null ? null : <Text style={[styles.caption, { color: color.textMuted }]}>{lines.note}</Text>}
      <Text style={[styles.caption, { color: color.textMuted }]}>{lines.basis}</Text>
    </View>
  );
}

export interface InsightCardsProps {
  data: InsightData;
  medicationName: (id: string) => string | null;
}

export function InsightCards({ data, medicationName }: InsightCardsProps): React.JSX.Element {
  const { locale, t, tp } = useI18n();
  const { color } = useTheme();
  const motion = useMotion();
  const { insights, needs, attackDates } = useMemo(
    () => ({
      insights: computeInsights(data, pack),
      needs: insightNeeds(data, pack),
      attackDates: data.episodes.map((episode) => localDateIn(new Date(episode.startedAt), data.timeZone)),
    }),
    [data],
  );
  const ctx: InsightTextContext = { locale, t, tp, medicationName, today: localDateIn(data.now, data.timeZone), trackingSince: data.trackingSince, attackDates };
  const byKind = new Map<InsightKind, Insight[]>();
  for (const insight of insights) byKind.set(insight.kind, [...(byKind.get(insight.kind) ?? []), insight]);
  const rise = motion.level === 'subtle' ? 4 : 8;
  // Every real record set gives at least the monthly card or its need; this line only guards an empty result.
  if (insights.length === 0 && needs.length === 0) {
    return <Text style={[styles.small, { color: color.text }]}>{t('insight.empty')}</Text>;
  }

  // Sections already there on mount snap in; one that appears later (a kind reaching its minimum) rises once.
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={styles.list}>
        {INSIGHT_KINDS.map((kind) => {
          const shown = byKind.get(kind);
          const need = needs.find((item) => item.kind === kind);
          if (shown !== undefined) {
            return (
              <Animated.View key={`card-${kind}`} entering={entrance(motion, rise)}>
                <InsightCard kind={kind} lines={cardLines(shown, ctx)} />
              </Animated.View>
            );
          }
          return need === undefined ? null : (
            <Animated.View key={`need-${kind}`} entering={entrance(motion, rise)}>
              <NeedCard need={need} />
            </Animated.View>
          );
        })}
        {needs.length === 0 ? null : <Text style={[styles.caption, { color: color.textMuted }]}>{t('insight.need.hint')}</Text>}
      </View>
    </LayoutAnimationConfig>
  );
}

const styles = StyleSheet.create({
  ...sectionStyle,
  list: { gap: space[4] },
  figure: { fontFamily: fonts.bodyBold, fontSize: type.display, lineHeight: 35, fontVariant: ['tabular-nums'] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  label: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  columns: { flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, alignItems: 'center', gap: space[0] },
  columnValue: { fontFamily: fonts.bodyBold, fontSize: type.caption, lineHeight: 16, fontVariant: ['tabular-nums'] },
  columnBar: { width: '70%', maxWidth: 28, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  columnLabel: {
    alignSelf: 'stretch',
    textAlign: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space[0],
    fontFamily: fonts.body,
    fontSize: type.caption,
    lineHeight: 17,
  },
  rows: { gap: space[3] },
  row: { gap: space[0] },
  rowTop: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space[3] },
  meter: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3 },
});
