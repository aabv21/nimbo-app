// Profile → Notifications: the permission and "Allow notifications" while it isn't granted, the hours, the daily cap
// (the only way to opt out) and the lock-screen detail (docs/app.md#push-srcpush).
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { formatClock } from '../i18n/format';
import { useOnResume } from '../lib/useOnResume';
import { registerPush } from '../push/pushRegistration';
import { useLastOutcome } from '../push/pushStore';
import { Button } from '../ui/Button';
import { ChoiceGroup } from '../ui/ChoiceGroup';
import { Notice } from '../ui/Notice';
import { SwitchRow } from '../ui/SwitchRow';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { useProfileChange } from './useProfileChange';

type Cap = '0' | '1' | '2';
const CAPS: readonly Cap[] = ['0', '1', '2'];

type Permission = 'granted' | 'ask' | 'denied' | 'blocked';

/** `ask`: never answered; `denied`: refused, the system can still ask; `blocked`: only Settings can change it. */
function permissionOf(status: Notifications.NotificationPermissionsStatus): Permission {
  if (status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (!status.canAskAgain) return 'blocked';
  return status.status === Notifications.PermissionStatus.DENIED ? 'denied' : 'ask';
}

/** `HH:MM[:SS]` as a time on an arbitrary day, for the picker and the clock label. */
function dateOf(time: string): Date {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes);
}

const pad = (value: number): string => String(value).padStart(2, '0');
const timeOf = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
const sameClock = (a: string, b: string): boolean => a.slice(0, 5) === b.slice(0, 5);

/**
 * A time field: Android opens the system dialog, which answers once; iOS shows the spinner under it and saves the time
 * when it closes (Done, the field again, or leaving the screen), not on every turn of the wheel.
 */
function TimeField({ label, value, onChange, testID }: { label: string; value: string; onChange: (time: string) => void; testID: string }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { name, color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  // The spinner's time while it is open on iOS; null while closed.
  const [draft, setDraft] = useState<string | null>(null);
  const open = draft !== null;
  const date = dateOf(draft ?? value);
  const shown = formatClock(date, locale);

  // Leaving the screen with the spinner open still saves what it shows.
  const unsaved = useRef<{ draft: string | null; value: string; onChange: (time: string) => void }>({ draft: null, value, onChange });
  useEffect(() => {
    unsaved.current = { draft, value, onChange };
  });
  useEffect(
    () => () => {
      const last = unsaved.current;
      if (last.draft !== null && last.draft !== last.value) last.onChange(last.draft);
    },
    [],
  );

  const close = (): void => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };

  const press = (): void => {
    if (Platform.OS !== 'android') {
      if (open) close();
      else setDraft(value);
      return;
    }
    DateTimePickerAndroid.open({
      mode: 'time',
      value: date,
      is24Hour: locale !== 'en',
      onValueChange: (_event, picked) => {
        onChange(timeOf(picked));
      },
    });
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      <Animated.View style={scaleStyle}>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${shown}`}
          accessibilityState={{ expanded: open }}
          onPress={press}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={[styles.input, { borderColor: color.border, backgroundColor: color.surface }]}
        >
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
          <Text style={[styles.value, { color: color.text }]}>{shown}</Text>
        </Pressable>
      </Animated.View>
      {open && Platform.OS !== 'android' ? (
        <>
          <DateTimePicker
            mode="time"
            display="spinner"
            value={date}
            locale={locale}
            themeVariant={name === 'day' ? 'light' : 'dark'}
            accentColor={color.accent}
            onValueChange={(_event, picked) => {
              setDraft(timeOf(picked));
            }}
          />
          <Button testID={`${testID}-done`} variant="secondary" label={t('common.done')} onPress={close} />
        </>
      ) : null}
    </View>
  );
}

/** The permission line and its button; "unavailable" once granted but no token could be had on this build. */
function PermissionRow({ userId }: { userId: string }): React.JSX.Element | null {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const outcome = useLastOutcome();
  const [permission, setPermission] = useState<Permission | null>(null);
  const [asking, setAsking] = useState(false);
  // Bumped to read the permission again: back from Settings, or after the prompt.
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const live = { current: true };
    Notifications.getPermissionsAsync().then(
      (status) => {
        if (live.current) setPermission(permissionOf(status));
      },
      () => undefined,
    );
    return () => {
      live.current = false;
    };
  }, [reads]);
  useOnResume(() => {
    setReads((count) => count + 1);
  });

  const allow = async (): Promise<void> => {
    if (permission === 'blocked') {
      await Linking.openSettings().catch(() => undefined);
      return;
    }
    setAsking(true);
    try {
      await registerPush(userId, locale);
    } finally {
      setAsking(false);
      setReads((count) => count + 1);
    }
  };

  if (permission === null) return null;
  if (permission === 'granted') {
    const problem: MessageKey | null =
      outcome === 'unavailable' ? 'notif.unavailable' : outcome === 'verifying' ? 'notif.verifying' : outcome === 'failed' ? 'error.generic' : null;
    return problem === null ? null : (
      <Text accessibilityLiveRegion="polite" style={[styles.sub, { color: color.textMuted }]}>
        {t(problem)}
      </Text>
    );
  }
  return (
    <View style={styles.permission}>
      {permission === 'ask' ? null : <Notice tone="warning" announce={false} title={t('notif.denied')} />}
      <Button
        testID="notifications-allow"
        label={t('onb.notif.allow')}
        loading={asking}
        loadingLabel={t('common.loading')}
        onPress={() => {
          void allow();
        }}
      />
    </View>
  );
}

export function NotificationSettings({ userId }: { userId: string }): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const { profile } = useAuth();
  const { change, error } = useProfileChange();

  if (profile === null) return null;

  return (
    <View style={styles.section}>
      {error === undefined ? null : <Notice tone="danger" title={t(error === 'network' ? 'error.network' : 'error.generic')} />}
      <PermissionRow userId={userId} />

      <View style={styles.setting}>
        <Text style={[styles.body, { color: color.text }]}>{t('notif.hours')}</Text>
        <View style={styles.hours}>
          <View style={styles.hour}>
            <TimeField
              testID="notif-hours-start"
              label={t('notif.hours.start')}
              value={profile.notifyStart}
              onChange={(notifyStart) => {
                void change({ notifyStart });
              }}
            />
          </View>
          <View style={styles.hour}>
            <TimeField
              testID="notif-hours-end"
              label={t('notif.hours.end')}
              value={profile.notifyEnd}
              onChange={(notifyEnd) => {
                void change({ notifyEnd });
              }}
            />
          </View>
        </View>
        {sameClock(profile.notifyStart, profile.notifyEnd) ? (
          <Text accessibilityLiveRegion="polite" style={[styles.help, { color: color.textMuted }]}>
            {t('notif.hours.empty')}
          </Text>
        ) : null}
      </View>

      <View style={styles.setting}>
        <Text style={[styles.body, { color: color.text }]}>{t('notif.cap')}</Text>
        <ChoiceGroup<Cap>
          label={t('notif.cap')}
          layout="segmented"
          value={String(profile.notifyDailyCap) as Cap}
          choices={CAPS.map((value) => ({ value, label: value === '0' ? t('notif.cap.value.zero') : value }))}
          onChange={(value) => {
            void change({ notifyDailyCap: Number(value) as 0 | 1 | 2 });
          }}
        />
      </View>

      <SwitchRow
        title={t('profile.lock_detail')}
        sub={t('profile.lock_detail.sub')}
        value={profile.lockScreenDetail}
        onChange={(lockScreenDetail) => {
          void change({ lockScreenDetail });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[3] },
  setting: { gap: space[2] },
  permission: { gap: space[2] },
  hours: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  hour: { flexGrow: 1, flexBasis: 140 },
  field: { gap: space[1] },
  label: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  input: {
    minHeight: controlHeight,
    justifyContent: 'center',
    paddingHorizontal: space[2],
    borderWidth: 1,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  value: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  help: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
});
