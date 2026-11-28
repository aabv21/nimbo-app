// Edits every field of an attack, times included. Only what changed is saved; notes are checked for red flags once saved.
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../../auth/AuthProvider';
import { Chip } from '../../../checkin/Chip';
import { packs } from '../../../condition';
import type { CatalogName } from '../../../condition';
import { IntensityScale } from '../../../crisis/IntensityScale';
import { NOTES_MAX_LENGTH, updateEpisode, useEpisode } from '../../../episodes/episodeStore';
import type { Episode, EpisodePatch } from '../../../episodes/episodeStore';
import { DateTimeField } from '../../../history/DateTimeField';
import { useI18n } from '../../../i18n';
import type { MessageKey } from '../../../i18n';
import { useRedFlagCheck } from '../../../redflags/useRedFlagCheck';
import { BackButton } from '../../../ui/BackButton';
import { Button } from '../../../ui/Button';
import { Screen } from '../../../ui/Screen';
import { TextField } from '../../../ui/TextField';
import { fonts, space, type } from '../../../ui/theme';
import { useTheme } from '../../../ui/themeContext';

const SAVED_HOLD_MS = 1000;

type ListField = 'painAreas' | 'symptoms' | 'triggers' | 'reliefs';
const LISTS: readonly { field: ListField; catalog: CatalogName; title: MessageKey }[] = [
  { field: 'painAreas', catalog: 'painAreas', title: 'episode.where' },
  { field: 'symptoms', catalog: 'symptoms', title: 'draft.k.symptoms' },
  { field: 'triggers', catalog: 'triggers', title: 'episode.triggers' },
  { field: 'reliefs', catalog: 'reliefs', title: 'episode.reliefs' },
];

interface Form {
  startedAt: Date;
  endedAt: Date | null;
  intensity: number | null;
  painAreas: readonly string[];
  symptoms: readonly string[];
  triggers: readonly string[];
  reliefs: readonly string[];
  notes: string;
}

function formOf(episode: Episode): Form {
  return {
    startedAt: new Date(episode.startedAt),
    endedAt: episode.endedAt === null ? null : new Date(episode.endedAt),
    intensity: episode.intensity,
    painAreas: episode.painAreas,
    symptoms: episode.symptoms,
    triggers: episode.triggers,
    reliefs: episode.reliefs,
    notes: episode.notes ?? '',
  };
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((key) => b.includes(key));

/** Only the fields that differ from `before`, so a save never overwrites what another phone changed. */
function changes(before: Form, after: Form): EpisodePatch {
  const notes = after.notes.trim();
  return {
    ...(after.startedAt.getTime() === before.startedAt.getTime() ? {} : { startedAt: after.startedAt.toISOString() }),
    ...(after.endedAt?.getTime() === before.endedAt?.getTime() ? {} : { endedAt: after.endedAt?.toISOString() ?? null }),
    ...(after.intensity === before.intensity || after.intensity === null ? {} : { intensity: after.intensity }),
    ...(sameSet(after.painAreas, before.painAreas) ? {} : { painAreas: after.painAreas }),
    ...(sameSet(after.symptoms, before.symptoms) ? {} : { symptoms: after.symptoms }),
    ...(sameSet(after.triggers, before.triggers) ? {} : { triggers: after.triggers }),
    ...(sameSet(after.reliefs, before.reliefs) ? {} : { reliefs: after.reliefs }),
    ...(notes === before.notes.trim() ? {} : { notes: notes === '' ? null : notes }),
  };
}

function Editor({ userId, episode }: { userId: string; episode: Episode }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const checkRedFlags = useRedFlagCheck();
  const [before] = useState(() => formOf(episode));
  const [form, setForm] = useState<Form>(before);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The saved notes still to be checked: urgent care opens after the confirmation, never in place of it.
  const pendingNotes = useRef<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };
  const toggle = (field: ListField, key: string): void => {
    const chosen = form[field];
    set(field, chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key]);
  };
  const endBeforeStart = form.endedAt !== null && form.endedAt.getTime() < form.startedAt.getTime();

  const flush = (): void => {
    const text = pendingNotes.current;
    if (text === null) return;
    pendingNotes.current = null;
    checkRedFlags(text, 'text');
  };
  // Close and Cancel stay live during the confirmation: whichever comes first leaves, once, so the
  // timer's back cannot dismiss the urgent-care screen the first one opened.
  const left = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leave = (): void => {
    if (left.current) return;
    left.current = true;
    clearTimeout(timer.current);
    router.back();
    // After the back, so urgent care lands over the screen the user returns to.
    flush();
  };

  // The latest `leave` and `flush`, so a re-render during the hold does not restart the timer.
  const latest = useRef({ leave, flush });
  useEffect(() => {
    latest.current = { leave, flush };
  });
  useEffect(() => {
    if (!done) return undefined;
    timer.current = setTimeout(() => {
      latest.current.leave();
    }, SAVED_HOLD_MS);
    return () => {
      clearTimeout(timer.current);
    };
  }, [done]);
  // Left by the system back during the confirmation: the saved notes are still checked.
  useEffect(
    () => () => {
      latest.current.flush();
    },
    [],
  );

  const save = (): void => {
    if (endBeforeStart || done) return;
    const patch = changes(before, form);
    if (Object.keys(patch).length === 0) {
      router.back();
      return;
    }
    try {
      updateEpisode(userId, episode.id, patch);
    } catch (thrown) {
      // A time the store refuses (out of range) is shown in the form, not thrown from the press.
      setError(thrown instanceof RangeError ? t('episode.time.error') : t('error.generic'));
      return;
    }
    if (patch.notes !== undefined && patch.notes !== null) pendingNotes.current = patch.notes;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(true);
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={leave} style={styles.close}>
          <X size={24} color={color.text} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('episode.edit.title')}
        </Text>
      </View>

      <DateTimeField
        label={t('episode.start')}
        value={form.startedAt}
        empty=""
        onChange={(value) => {
          set('startedAt', value);
        }}
      />
      <View style={styles.group}>
        <DateTimeField
          label={t('episode.end')}
          value={form.endedAt}
          empty={t('episode.end.set')}
          invalid={endBeforeStart}
          onChange={(value) => {
            set('endedAt', value);
          }}
        />
        {endBeforeStart ? (
          <Text accessibilityRole="alert" style={[styles.error, { color: color.danger }]}>
            {t('episode.end.error')}
          </Text>
        ) : null}
      </View>

      <IntensityScale
        value={form.intensity}
        onChange={(value) => {
          set('intensity', value);
        }}
      />

      {LISTS.map(({ field, catalog, title }) => (
        <View key={field} style={styles.group}>
          <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
            {t(title)}
          </Text>
          <View style={styles.chips}>
            {packs.migraine[catalog].map((item) => (
              <Chip
                key={item.key}
                role="checkbox"
                label={t(item.labelKey as MessageKey)}
                selected={form[field].includes(item.key)}
                onPress={() => {
                  toggle(field, item.key);
                }}
              />
            ))}
          </View>
        </View>
      ))}

      <TextField
        testID="episode-notes"
        label={t('episode.notes')}
        value={form.notes}
        onChangeText={(text) => {
          set('notes', text);
        }}
        maxLength={NOTES_MAX_LENGTH}
        multiline
      />

      {error === null ? null : (
        <Text accessibilityRole="alert" style={[styles.error, { color: color.danger }]}>
          {error}
        </Text>
      )}
      <View style={styles.actions}>
        <Button variant="secondary" label={t('common.cancel')} onPress={leave} />
        <Button
          testID="episode-save"
          swap
          label={done ? t('common.done') : t('common.save')}
          {...(done ? { icon: Check } : {})}
          disabled={endBeforeStart}
          style={styles.grow}
          onPress={save}
        />
      </View>
    </Screen>
  );
}

function Missing(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <Screen>
      <BackButton label={t('common.back')} onPress={router.back} />
    </Screen>
  );
}

export default function EpisodeEdit(): React.JSX.Element | null {
  const { userId } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  return userId === null ? null : <EditLoader userId={userId} id={id} />;
}

function EditLoader({ userId, id }: { userId: string; id: string }): React.JSX.Element {
  const episode = useEpisode(userId, id);
  return episode === null ? <Missing /> : <Editor userId={userId} episode={episode} />;
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  group: { gap: space[2] },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  error: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
