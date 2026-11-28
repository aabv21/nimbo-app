// Today's medication section: this month's dose days per class against its limit, the overuse notice and the
// next preventive dose still due today.
import { router } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { daysLeftInMonth, doseDaysForMonth } from '../cabinet/doseDays';
import { useDoses } from '../cabinet/doseStore';
import { classLabelKey } from '../cabinet/medicationLabels';
import { useMedications } from '../cabinet/medicationStore';
import type { Medication } from '../cabinet/medicationStore';
import { nextPreventive } from '../cabinet/nextPreventive';
import { mostUrgent, OveruseNotice } from '../cabinet/OveruseNotice';
import { overuseStatus, packs } from '../condition';
import type { MedicationClass, OveruseEntry, OveruseLevel, OveruseStatus } from '../condition';
import { formatClock } from '../i18n/format';
import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';

const pack = packs.migraine;

export interface MedicationMonth {
  /** Every medication on the phone, archived ones included: their past doses still count. */
  medications: readonly Medication[];
  status: OveruseStatus;
  /** The highest level across the classes and the combined count. */
  level: OveruseLevel;
  /** The classes to show: the active acute ones and any with a dose this month, in the pack's order. */
  classes: readonly { medicationClass: MedicationClass; entry: OveruseEntry }[];
  daysLeft: number;
  next: { medication: Medication; at: Date } | null;
  /** Nothing in the cabinet and no dose this month: the section explains itself instead. */
  empty: boolean;
  /** Any dose on the phone, in any month. */
  anyDose: boolean;
}

export function useMedicationMonth(userId: string, now: Date, timeZone: string): MedicationMonth {
  const medications = useMedications(userId, { includeArchived: true });
  const doses = useDoses(userId);
  const days = doseDaysForMonth(doses, medications, now, timeZone);
  const status = overuseStatus(days, pack);
  const active = medications.filter((medication) => !medication.archived);
  const shown = new Set<MedicationClass>(active.filter((medication) => medication.kind === 'acute').map((medication) => medication.medicationClass));
  for (const [medicationClass, dates] of Object.entries(days)) if (dates.length > 0) shown.add(medicationClass as MedicationClass);
  const entries = new Map(Object.entries(status.byClass));
  return {
    medications,
    status,
    level: mostUrgent(status)?.entry.level ?? 'ok',
    classes: pack.medicationClasses.flatMap((medicationClass) => {
      const entry = entries.get(medicationClass);
      return shown.has(medicationClass) && entry !== undefined ? [{ medicationClass, entry }] : [];
    }),
    daysLeft: daysLeftInMonth(now, timeZone),
    next: nextPreventive(active, now, timeZone),
    empty: active.length === 0 && shown.size === 0,
    anyDose: doses.length > 0,
  };
}

function Metric({ medicationClass, entry }: { medicationClass: MedicationClass; entry: OveruseEntry }): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const value =
    entry.limit === null ? tp('today.med.days_nolimit', entry.days, { used: entry.days }) : t('today.med.days', { used: entry.days, limit: entry.limit });
  const fill = entry.level === 'limit' ? color.danger : entry.level === 'warn' ? color.warning : color.accent;
  return (
    <View style={styles.metric}>
      <View style={styles.metricLine}>
        <Text style={[styles.metricLabel, { color: color.textMuted }]}>{t(classLabelKey(medicationClass))}</Text>
        <Text style={[styles.metricValue, { color: color.text }]}>{value}</Text>
      </View>
      {/* The words above carry the count; the bar only repeats it for the eye. */}
      {entry.limit === null ? null : (
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.meter, { backgroundColor: color.border }]}>
          <View style={[styles.meterFill, { width: `${String(Math.min(entry.days / entry.limit, 1) * 100)}%`, backgroundColor: fill }]} />
        </View>
      )}
    </View>
  );
}

export function MedicationSummary({ month }: { month: MedicationMonth }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
        {t('today.med.title')}
      </Text>
      {month.empty ? (
        <>
          <Text style={[styles.small, { color: color.textMuted }]}>{t('today.med.empty')}</Text>
          <Button
            variant="secondary"
            icon={Plus}
            label={t('cabinet.add')}
            onPress={() => {
              router.push({ pathname: '/cabinet/[id]', params: { id: 'new' } });
            }}
          />
        </>
      ) : (
        <>
          <OveruseNotice status={month.status} daysLeft={month.daysLeft} />
          <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
            {month.classes.length === 0 ? null : (
              <>
                <Text style={[styles.caption, { color: color.textMuted }]}>{t('today.med.month')}</Text>
                {month.classes.map(({ medicationClass, entry }) => (
                  <Metric key={medicationClass} medicationClass={medicationClass} entry={entry} />
                ))}
              </>
            )}
            {month.next === null ? null : (
              <Text style={[styles.small, { color: color.textMuted }]}>
                {t('today.med.next', { med: month.next.medication.name, time: formatClock(month.next.at, locale) })}
              </Text>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  card: { gap: space[3], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  metric: { gap: space[1] },
  metricLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: space[2] },
  metricLabel: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  metricValue: { fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 26 },
  meter: { height: 6, borderRadius: 3, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 3 },
});
