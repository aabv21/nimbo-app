import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { classLabelKey } from '../../cabinet/medicationLabels';
import { saveMedication, useMedication } from '../../cabinet/medicationStore';
import type { Medication, MedicationInput } from '../../cabinet/medicationStore';
import { askNotificationPermission } from '../../cabinet/reminders';
import { packs } from '../../condition';
import type { MedicationClass } from '../../condition';
import { useI18n } from '../../i18n';
import { parseClock } from '../../i18n/format';
import { localDate } from '../../lib/localDate';
import { BackButton } from '../../ui/BackButton';
import { Button } from '../../ui/Button';
import { ChoiceGroup } from '../../ui/ChoiceGroup';
import { Screen } from '../../ui/Screen';
import { TextField } from '../../ui/TextField';
import { fonts, radius, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

type Kind = Medication['kind'];
type Form = Medication['form'];
type ScheduleChoice = 'none' | 'daily' | 'monthly' | 'quarterly';

const FORMS: readonly Form[] = ['oral', 'injection', 'nasal', 'other'];
const SCHEDULES: readonly ScheduleChoice[] = ['none', 'daily', 'monthly', 'quarterly'];
const MIN_HOURS = 0.5;
const MAX_HOURS = 72;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Hours as typed ("4", "1.5" or "1,5"); null when empty, NaN when out of range or not a number. */
function parseHours(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  // Digits and dots only, so "1e3" and "0x10" are not read as numbers.
  const hours = /^[\d.]+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  return hours >= MIN_HOURS && hours <= MAX_HOURS ? hours : Number.NaN;
}

function isIsoDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function hoursText(minutes: number | null): string {
  return minutes === null ? '' : String(Number((minutes / 60).toFixed(2)));
}

function inputOf(medication: Medication, archived: boolean): MedicationInput {
  return {
    name: medication.name,
    kind: medication.kind,
    form: medication.form,
    medicationClass: medication.medicationClass,
    doseText: medication.doseText,
    minIntervalHours: medication.minIntervalMinutes === null ? null : medication.minIntervalMinutes / 60,
    schedule: medication.schedule,
    scheduleTime: medication.scheduleTime,
    scheduleAnchor: medication.scheduleAnchor,
    archived,
  };
}

interface FormProps {
  userId: string;
  id: string;
  medication: Medication | undefined;
}

function MedicationForm({ userId, id, medication }: FormProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const [name, setName] = useState(medication?.name ?? '');
  const [kind, setKind] = useState<Kind>(medication?.kind ?? 'acute');
  const [medicationClass, setMedicationClass] = useState<MedicationClass>(medication?.medicationClass ?? 'simple_analgesic');
  const [form, setForm] = useState<Form>(medication?.form ?? 'oral');
  const [doseText, setDoseText] = useState(medication?.doseText ?? '');
  const [interval, setInterval] = useState(hoursText(medication?.minIntervalMinutes ?? null));
  const [schedule, setSchedule] = useState<ScheduleChoice>(medication?.schedule ?? 'none');
  const [time, setTime] = useState((medication?.scheduleTime ?? '').slice(0, 5));
  const [start, setStart] = useState(medication?.scheduleAnchor ?? localDate());
  const [submitted, setSubmitted] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const creating = medication === undefined;
  const nameValid = name.trim().length > 0 && name.trim().length <= 80;
  const hours = kind === 'acute' ? parseHours(interval) : null;
  const intervalValid = hours === null || !Number.isNaN(hours);
  const clock = parseClock(time);
  const scheduled = kind === 'preventive' && schedule !== 'none';
  const needsStart = scheduled && schedule !== 'daily';
  const scheduleValid = !scheduled || (clock !== null && (!needsStart || isIsoDate(start)));
  const startDay = isIsoDate(start) ? Number(start.slice(8, 10)) : 0;
  const clockText = clock === null ? '--:--' : `${pad(clock.hours)}:${pad(clock.minutes)}`;

  const scheduleLabel = (choice: ScheduleChoice): string => {
    switch (choice) {
      case 'none':
        return t('cabinet.schedule.none');
      case 'daily':
        return t('cabinet.schedule.daily', { time: clockText });
      case 'monthly':
        return t('cabinet.schedule.monthly', { day: startDay === 0 ? '--' : startDay, time: clockText });
      case 'quarterly':
        return t('cabinet.schedule.quarterly', { day: startDay === 0 ? '--' : startDay, time: clockText });
    }
  };

  const save = (): void => {
    setSubmitted(true);
    if (!nameValid || !intervalValid || !scheduleValid) return;
    saveMedication(userId, id, {
      name: name.trim(),
      kind,
      form,
      medicationClass,
      doseText: doseText.trim() === '' ? null : doseText.trim(),
      minIntervalHours: hours,
      schedule: scheduled ? schedule : null,
      scheduleTime: scheduled && clock !== null ? `${pad(clock.hours)}:${pad(clock.minutes)}:00` : null,
      scheduleAnchor: needsStart ? start.trim() : null,
      archived: medication?.archived ?? false,
    });
    // A schedule is useless without the permission, so the question comes with the save that needs it; the answer isn't awaited.
    if (scheduled) askNotificationPermission(locale).catch(() => undefined);
    router.back();
  };

  const archive = (): void => {
    if (medication === undefined) return;
    saveMedication(userId, id, inputOf(medication, true));
    router.back();
  };

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton label={t(creating ? 'common.close' : 'common.back')} onPress={() => { router.back(); }} />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t(creating ? 'cabinet.add' : 'cabinet.title')}
        </Text>
      </View>

      <TextField
        label={t('cabinet.name')}
        value={name}
        onChangeText={setName}
        maxLength={80}
        autoCapitalize="sentences"
        {...(submitted && !nameValid ? { error: t('cabinet.name.error') } : {})}
      />

      <View style={styles.field}>
        <Text style={[styles.label, { color: color.text }]}>{t('cabinet.kind')}</Text>
        <ChoiceGroup
          label={t('cabinet.kind')}
          layout="list"
          value={kind}
          choices={[
            { value: 'acute', label: t('cabinet.kind.acute') },
            { value: 'preventive', label: t('cabinet.kind.preventive') },
          ]}
          onChange={setKind}
        />
        <Text style={[styles.help, { color: color.textMuted }]}>
          {t(kind === 'acute' ? 'cabinet.kind.acute_sub' : 'cabinet.kind.preventive_sub')}
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: color.text }]}>{t('cabinet.class')}</Text>
        <ChoiceGroup
          label={t('cabinet.class')}
          layout="list"
          value={medicationClass}
          choices={packs.migraine.medicationClasses.map((value) => ({ value, label: t(classLabelKey(value)) }))}
          onChange={setMedicationClass}
        />
        <Text style={[styles.help, { color: color.textMuted }]}>{t('cabinet.class.help')}</Text>
      </View>

      <View style={styles.field}>
        <Text style={[styles.label, { color: color.text }]}>{t('cabinet.form')}</Text>
        <ChoiceGroup
          label={t('cabinet.form')}
          layout="segmented"
          value={form}
          choices={FORMS.map((value) => ({ value, label: t(value === 'other' ? 'med.class.other' : `cabinet.form.${value}`) }))}
          onChange={setForm}
        />
        <Text style={[styles.help, { color: color.textMuted }]}>{t('cabinet.form.help')}</Text>
      </View>

      <TextField label={t('cabinet.dose')} value={doseText} onChangeText={setDoseText} maxLength={120} />

      {kind === 'acute' ? (
        <TextField
          label={t('cabinet.interval')}
          value={interval}
          onChangeText={setInterval}
          keyboardType="decimal-pad"
          placeholder={t('cabinet.interval.ph')}
          help={t('cabinet.interval.help')}
          {...(submitted && !intervalValid ? { error: t('cabinet.interval.error') } : {})}
        />
      ) : (
        <View style={styles.field}>
          <Text accessibilityRole="header" style={[styles.label, { color: color.text }]}>
            {t('cabinet.schedule')}
          </Text>
          <ChoiceGroup
            label={t('cabinet.schedule')}
            layout="list"
            value={schedule}
            choices={SCHEDULES.map((value) => ({ value, label: scheduleLabel(value) }))}
            onChange={setSchedule}
          />
          {scheduled ? (
            <TextField
              label={t('cabinet.schedule.time')}
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
              {...(submitted && clock === null ? { error: t('cabinet.schedule.error') } : {})}
            />
          ) : null}
          {needsStart ? (
            <TextField
              label={t('cabinet.schedule.start')}
              value={start}
              onChangeText={setStart}
              keyboardType="numbers-and-punctuation"
              {...(submitted && !isIsoDate(start) ? { error: t('cabinet.schedule.error') } : {})}
            />
          ) : null}
        </View>
      )}

      <Button label={t('common.save')} onPress={save} />

      {creating ? null : archiving ? (
        <View style={[styles.confirm, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>{t('cabinet.archive.confirm')}</Text>
          <Button label={t('common.confirm')} onPress={archive} />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            onPress={() => {
              setArchiving(false);
            }}
          />
        </View>
      ) : (
        <Button
          variant="secondary"
          label={t('cabinet.archive')}
          onPress={() => {
            setArchiving(true);
          }}
        />
      )}
    </Screen>
  );
}

export default function MedicationScreen(): React.JSX.Element | null {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { userId } = useAuth();
  if (userId === null) return null;
  return <Loaded userId={userId} routeId={id} />;
}

function Loaded({ userId, routeId }: { userId: string; routeId: string }): React.JSX.Element | null {
  const creating = routeId === 'new';
  // Made once per visit, so a retried save edits the row rather than adding another.
  const [newId] = useState(() => randomUUID());
  const medication = useMedication(userId, creating ? '' : routeId);
  if (!creating && medication === undefined) return null;
  return <MedicationForm key={routeId} userId={userId} id={creating ? newId : routeId} medication={medication} />;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  field: { gap: space[1] },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  help: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  confirm: { gap: space[3], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
});
