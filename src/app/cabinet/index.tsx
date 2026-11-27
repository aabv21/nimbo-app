import { router } from 'expo-router';
import { ChevronRight, OctagonAlert, Plus, TriangleAlert } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { doseDaysForMonth, daysLeftInMonth } from '../../cabinet/doseDays';
import { useDoses } from '../../cabinet/doseStore';
import { classLabelKey } from '../../cabinet/medicationLabels';
import { useMedications } from '../../cabinet/medicationStore';
import type { Medication } from '../../cabinet/medicationStore';
import { OveruseNotice } from '../../cabinet/OveruseNotice';
import { overuseStatus, packs } from '../../condition';
import type { OveruseEntry } from '../../condition';
import { useI18n } from '../../i18n';
import { BackButton } from '../../ui/BackButton';
import { Button } from '../../ui/Button';
import { Screen } from '../../ui/Screen';
import { controlHeight, fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const pack = packs.migraine;

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function Tag({ entry }: { entry: OveruseEntry }): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const text =
    entry.limit === null
      ? tp('today.med.days_nolimit', entry.days, { used: entry.days })
      : t('today.med.days', { used: entry.days, limit: entry.limit });
  if (entry.level === 'ok') return <Text style={[styles.trail, { color: color.textMuted }]}>{text}</Text>;
  const danger = entry.level === 'limit';
  const Icon = danger ? OctagonAlert : TriangleAlert;
  const mark = danger ? color.danger : color.warning;
  // An icon and the words, never colour alone.
  return (
    <View style={styles.tag}>
      <Icon size={20} color={mark} />
      <Text style={[styles.trail, { color: color.text }]}>{text}</Text>
    </View>
  );
}

function Row({ medication, entry }: { medication: Medication; entry: OveruseEntry | undefined }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const sub = (() => {
    if (medication.kind === 'acute') return t(classLabelKey(medication.medicationClass));
    const time = (medication.scheduleTime ?? '').slice(0, 5);
    const day = Number((medication.scheduleAnchor ?? '').slice(8, 10));
    switch (medication.schedule) {
      case 'daily':
        return t('cabinet.schedule.daily', { time });
      case 'monthly':
        return t('cabinet.schedule.monthly', { day, time });
      case 'quarterly':
        return t('cabinet.schedule.quarterly', { day, time });
      case null:
        return t('cabinet.schedule.none');
    }
  })();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/cabinet/[id]', params: { id: medication.id } });
      }}
      style={[styles.row, { borderColor: color.border }]}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: color.text }]}>{medication.name}</Text>
        <Text style={[styles.sub, { color: color.textMuted }]}>{sub}</Text>
      </View>
      {entry === undefined ? null : <Tag entry={entry} />}
      <ChevronRight size={20} color={color.textMuted} />
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={[styles.groupTitle, { color: color.text }]}>
        {title}
      </Text>
      <View style={[styles.rows, { borderColor: color.border }]}>{children}</View>
    </View>
  );
}

export default function Cabinet(): React.JSX.Element | null {
  const { userId } = useAuth();
  // The tabs mount only for a signed-in user; this keeps the types honest.
  if (userId === null) return null;
  return <CabinetList userId={userId} />;
}

function CabinetList({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const all = useMedications(userId, { includeArchived: true });
  const doses = useDoses(userId);
  const now = new Date();
  const timeZone = deviceTimeZone();
  // Archived medications stay in the count: their past doses are still this month's days.
  const status = overuseStatus(doseDaysForMonth(doses, all, now, timeZone), pack);
  const shown = all.filter((med) => !med.archived);
  const acute = shown.filter((med) => med.kind === 'acute');
  const preventive = shown.filter((med) => med.kind === 'preventive');
  const add = (): void => {
    router.push({ pathname: '/cabinet/[id]', params: { id: 'new' } });
  };

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton label={t('common.back')} onPress={() => { router.back(); }} />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('cabinet.title')}
        </Text>
      </View>

      {shown.length === 0 ? (
        <View style={styles.empty}>
          <Text accessibilityRole="header" style={[styles.display, { color: color.text }]}>
            {t('cabinet.empty.title')}
          </Text>
          <Text style={[styles.body, { color: color.text }]}>{t('cabinet.empty.body')}</Text>
          <Button label={t('cabinet.add')} icon={Plus} onPress={add} />
        </View>
      ) : (
        <>
          <OveruseNotice status={status} daysLeft={daysLeftInMonth(now, timeZone)} />
          {acute.length === 0 ? null : (
            <Group title={t('cabinet.kind.acute')}>
              {acute.map((med) => (
                <Row key={med.id} medication={med} entry={status.byClass[med.medicationClass]} />
              ))}
            </Group>
          )}
          {preventive.length === 0 ? null : (
            <Group title={t('cabinet.kind.preventive')}>
              {preventive.map((med) => (
                <Row key={med.id} medication={med} entry={undefined} />
              ))}
            </Group>
          )}
          <Button variant="secondary" label={t('cabinet.add')} icon={Plus} onPress={add} />
          <Text style={[styles.caption, { color: color.textMuted }]}>{t('cabinet.limits.source')}</Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  empty: { gap: space[3], paddingTop: space[5] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  group: { gap: space[1] },
  groupTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  rows: { borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight + space[2], paddingVertical: space[1], borderBottomWidth: 1 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  trail: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: space[0] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
});
