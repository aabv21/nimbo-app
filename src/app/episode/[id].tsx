// One attack: every field it holds, its doses, and Edit and Delete.
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../../auth/AuthProvider';
import { useDoses } from '../../cabinet/doseStore';
import { useMedications } from '../../cabinet/medicationStore';
import type { CatalogName } from '../../condition';
import { deleteEpisode, useEpisode } from '../../episodes/episodeStore';
import type { Episode } from '../../episodes/episodeStore';
import { dayTitle } from '../../history/dateLabels';
import { catalogLabelKey } from '../../history/labels';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { formatClock, formatDuration } from '../../i18n/format';
import { BackButton } from '../../ui/BackButton';
import { Screen } from '../../ui/Screen';
import { TextLink } from '../../ui/TextLink';
import { controlHeight, fonts, radius, space, type } from '../../ui/theme';
import { useTheme, useTones } from '../../ui/themeContext';
import { usePressFeedback } from '../../ui/usePressFeedback';

const MINUTE_MS = 60 * 1000;
// Only an attack logged by voice or in a chat says so; one typed in by hand shows nothing.
const SOURCE_LINES: Record<Episode['source'], MessageKey | null> = { manual: null, voice: 'episode.source', chat: 'episode.source.chat' };

function Row({ label, children, testID }: { label: string; children: React.ReactNode; testID?: string }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View testID={testID} style={[styles.row, { borderBottomColor: color.border }]}>
      <Text style={[styles.term, { color: color.textMuted }]}>{label}</Text>
      <View style={styles.lines}>{children}</View>
    </View>
  );
}

function DeleteButton({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.delete, { borderColor: color.danger }]}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tones.noticeDanger }, pressedStyle]} />
        <Text style={[styles.deleteLabel, { color: color.danger }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function Detail({ userId, id }: { userId: string; id: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const episode = useEpisode(userId, id);
  const doses = useDoses(userId, { episodeId: id });
  const medications = useMedications(userId, { includeArchived: true });

  if (episode === null) {
    // Deleted on another phone, or a stale link.
    return (
      <Screen>
        <BackButton label={t('common.back')} onPress={router.back} />
      </Screen>
    );
  }

  const start = new Date(episode.startedAt);
  const end = episode.endedAt === null ? null : new Date(episode.endedAt);
  const times =
    end === null
      ? formatClock(start, locale)
      : t('episode.times', {
          start: formatClock(start, locale),
          end: formatClock(end, locale),
          duration: formatDuration(Math.floor((end.getTime() - start.getTime()) / MINUTE_MS)),
        });
  const labels = (catalog: CatalogName, keys: readonly string[]): string[] =>
    keys.flatMap((key) => {
      const labelKey = catalogLabelKey(catalog, key);
      return labelKey === null ? [] : [t(labelKey)];
    });
  const medicationName = (medicationId: string): string =>
    medications.find((medication) => medication.id === medicationId)?.name ?? t('draft.k.dose');
  // The debrief's answers: the comfort measures, then the medications whose doses were marked, each once.
  const marked = (helped: boolean): string[] => [
    ...new Set(doses.filter((dose) => dose.helped === helped).map((dose) => medicationName(dose.medicationId))),
  ];
  const lists: { label: string; lines: string[]; testID?: string }[] = [
    { label: t('episode.where'), lines: labels('painAreas', episode.painAreas) },
    { label: t('draft.k.symptoms'), lines: labels('symptoms', episode.symptoms) },
    { label: t('episode.triggers'), lines: labels('triggers', episode.triggers) },
    { label: t('episode.reliefs'), lines: labels('reliefs', episode.reliefs) },
    { label: t('episode.helped'), lines: [...labels('reliefs', episode.helped), ...marked(true)], testID: 'episode-helped' },
    { label: t('episode.not_helped'), lines: [...labels('reliefs', episode.didNotHelp), ...marked(false)], testID: 'episode-not-helped' },
    {
      label: t('draft.k.dose'),
      // Oldest first, as the attack went.
      lines: [...doses].reverse().map((dose) =>
        t('today.attack.dose_v', { med: medicationName(dose.medicationId), time: formatClock(new Date(dose.takenAt), locale) }),
      ),
    },
  ];
  const sourceKey = SOURCE_LINES[episode.source];

  const confirmDelete = (): void => {
    Alert.alert(t('episode.delete'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('episode.delete'),
        style: 'destructive',
        onPress: () => {
          deleteEpisode(userId, id);
          router.back();
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <BackButton label={t('common.back')} onPress={router.back} />
        <TextLink
          testID="episode-edit"
          label={t('common.edit')}
          onPress={() => {
            router.push({ pathname: '/episode/[id]/edit', params: { id } });
          }}
        />
      </View>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {dayTitle(start, locale)}
        </Text>
        <Text style={[styles.small, { color: color.textMuted }]}>{times}</Text>
      </View>
      <View>
        {episode.intensity === null ? null : (
          <Row label={t('crisis.intensity.label')}>
            <Text style={[styles.number, { color: color.text }]}>{episode.intensity}</Text>
          </Row>
        )}
        {lists.map(({ label, lines, testID }) =>
          lines.length === 0 ? null : (
            <Row key={label} label={label} {...(testID === undefined ? {} : { testID })}>
              {lines.map((line, index) => (
                <Text key={`${line}-${String(index)}`} style={[styles.line, { color: color.text }]}>
                  {line}
                </Text>
              ))}
            </Row>
          ),
        )}
        {episode.notes === null || episode.notes === '' ? null : (
          <Row label={t('episode.notes')}>
            <Text style={[styles.line, { color: color.text }]}>{episode.notes}</Text>
          </Row>
        )}
      </View>
      {sourceKey === null ? null : <Text style={[styles.caption, { color: color.textMuted }]}>{t(sourceKey)}</Text>}
      <DeleteButton label={t('episode.delete')} onPress={confirmDelete} />
    </Screen>
  );
}

export default function EpisodeDetail(): React.JSX.Element | null {
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  return userId === null ? null : <Detail userId={userId} id={id} />;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  head: { gap: space[0] },
  title: { fontFamily: fonts.display, fontSize: type.title, lineHeight: 27 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  row: { gap: space[0], paddingVertical: space[2], borderBottomWidth: StyleSheet.hairlineWidth },
  term: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  lines: { gap: space[0] },
  line: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  number: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  delete: { minHeight: controlHeight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: radius.control, overflow: 'hidden' },
  deleteLabel: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
});
