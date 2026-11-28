// "What helped before": the user's crisis plan, the top three reliefs and medications from their debriefs, ranked
// in code over the phone's own records, so it works with the AI off and offline.
import { Check, Plus } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/AuthProvider';
import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import type { Medication } from '../cabinet/medicationStore';
import { crisisPlan, packs } from '../condition';
import type { PlanEntry } from '../condition';
import { updateEpisode, useEpisode, useEpisodes } from '../episodes/episodeStore';
import { catalogLabelKey } from '../history/labels';
import { useI18n } from '../i18n';
import { deviceTimeZone } from '../lib/localDate';
import { crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { DoseButton } from './DoseButton';
import { useMinuteClock } from './useMinuteClock';

const PLAN_ROWS = 3;

/** A medication row carries the medication, for its dose button; a relief row has none. */
type PlanRow = { entry: PlanEntry; label: string; medication: Medication | null };
// The device's zone, as the dose buttons above use it.

function DoingChip({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const Icon = checked ? Check : Plus;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${t('crisis.helped.doing')}, ${label}`}
      accessibilityState={{ checked }}
      onPress={onPress}
      style={[styles.chip, { borderColor: checked ? color.accent : color.border }, checked && { backgroundColor: tones.opaquePill }]}
    >
      <Icon size={18} color={checked ? color.text : color.textMuted} />
      <Text style={[styles.chipLabel, { color: checked ? color.text : color.textMuted }]}>{t('crisis.helped.doing')}</Text>
    </Pressable>
  );
}

export function WhatHelped({ episodeId }: { episodeId: string }): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const { userId } = useAuth();
  const user = userId ?? '';
  const episodes = useEpisodes(user);
  const episode = useEpisode(user, episodeId);
  const doses = useDoses(user);
  const medications = useMedications(user);
  const now = useMinuteClock();

  const rows = useMemo((): PlanRow[] => {
    const active = new Map(medications.map((medication) => [medication.id, medication]));
    // A medication the user archived is no longer theirs to reach for; it is left out before the top three are taken.
    return crisisPlan(episodes, doses)
      .flatMap((entry): PlanRow[] => {
        if (entry.kind === 'relief') {
          const labelKey = catalogLabelKey('reliefs', entry.key);
          return labelKey === null ? [] : [{ entry, label: t(labelKey), medication: null }];
        }
        const medication = active.get(entry.key);
        return medication === undefined ? [] : [{ entry, label: medication.name, medication }];
      })
      .slice(0, PLAN_ROWS);
  }, [episodes, doses, medications, t]);

  if (rows.length === 0 || episode === null) return null;

  // Code, not the model, writes this: a tap on the user's own record, so a press never throws past here.
  const toggleRelief = (key: string): void => {
    const chosen = new Set(episode.reliefs);
    if (chosen.has(key)) chosen.delete(key);
    else chosen.add(key);
    try {
      updateEpisode(user, episodeId, { reliefs: packs.migraine.reliefs.map((item) => item.key).filter((item) => chosen.has(item)) });
    } catch {
      // A relief from the pack on the user's own open attack has nothing the store refuses; nothing to show.
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('crisis.helped.title')}
      </Text>
      {rows.map(({ entry, label, medication }) => (
        <View key={entry.key} style={styles.row}>
          {medication === null ? (
            <View style={[styles.reliefRow, { borderColor: color.border }]}>
              <View style={styles.main}>
                <Text style={[styles.rowTitle, { color: color.text }]}>{label}</Text>
                <Text style={[styles.small, { color: color.textMuted }]}>{t('crisis.helped.row', { n: entry.helped, of: entry.of })}</Text>
              </View>
              <DoingChip
                label={label}
                checked={episode.reliefs.includes(entry.key)}
                onPress={() => {
                  toggleRelief(entry.key);
                }}
              />
            </View>
          ) : (
            <>
              <Text style={[styles.small, { color: color.textMuted }]}>{t('crisis.helped.row', { n: entry.helped, of: entry.of })}</Text>
              <DoseButton userId={user} episodeId={episodeId} medication={medication} now={now} timeZone={deviceTimeZone()} inPlan />
            </>
          )}
        </View>
      ))}
      <Text style={[styles.caption, { color: color.textMuted }]}>{t('crisis.helped.from')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  title: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  row: { gap: space[1] },
  reliefRow: {
    minHeight: crisisControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: space[2],
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    borderRadius: radius.card,
    borderWidth: 1,
  },
  main: { flex: 1, minWidth: 140, gap: space[0] },
  rowTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 22 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  chip: {
    maxWidth: '100%',
    minHeight: crisisControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
  },
  chipLabel: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
});
