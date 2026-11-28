import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { needsAiReconsent, policyUrl } from '../../account/consent';
import { useAuth } from '../../auth/AuthProvider';
import { authErrorMessage } from '../../auth/errors';
import { useSignOut } from '../../auth/useSignOut';
import { useMedications } from '../../cabinet/medicationStore';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { useLocalePreference } from '../../i18n/I18nProvider';
import type { LocalePreference } from '../../i18n/I18nProvider';
import type { RequestErrorKind } from '../../lib/requestResult';
import { useSyncState } from '../../lib/sync/SyncProvider';
import { useOncePerFocus } from '../../lib/useOncePerFocus';
import { useAgentNotes } from '../../memory/useAgentNotes';
import { NotificationSettings } from '../../profile/NotificationSettings';
import { setAiConsent } from '../../profile/profileRepository';
import type { ThemePreference } from '../../profile/profileRepository';
import { useProfileChange } from '../../profile/useProfileChange';
import { Button } from '../../ui/Button';
import { ChoiceGroup } from '../../ui/ChoiceGroup';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { SwitchRow } from '../../ui/SwitchRow';
import { TextLink } from '../../ui/TextLink';
import { useTabBarInset } from '../../ui/TabBar';
import { controlHeight, fonts, radius, space, type } from '../../ui/theme';
import { useTheme, useTones } from '../../ui/themeContext';
import { usePressFeedback } from '../../ui/usePressFeedback';

const LANGUAGES: readonly LocalePreference[] = ['system', 'en', 'es', 'pt'];
const APPEARANCES: readonly ThemePreference[] = ['system', 'day', 'dark', 'dim'];

function errorKey(kind: RequestErrorKind): MessageKey {
  return kind === 'network' ? 'error.network' : 'error.generic';
}

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  const { color } = useTheme();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Opens the cabinet; the count is the medications still in use, kept on this phone. */
function CabinetRow({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const count = useMedications(userId).length;
  return (
    <Pressable
      testID="profile-cabinet"
      accessibilityRole="button"
      onPress={() => {
        router.push('/cabinet');
      }}
      style={[styles.navRow, { borderColor: color.border }]}
    >
      <Text style={[styles.body, styles.navLabel, { color: color.text }]}>{t('cabinet.title')}</Text>
      <Text style={[styles.sub, { color: color.textMuted }]}>{String(count)}</Text>
      <ChevronRight size={20} color={color.textMuted} />
    </Pressable>
  );
}

/**
 * Opens the agent's notes, with the AI on or off: they are the user's data either way. The count shows once a cached
 * copy or a read exists.
 */
function MemoryRow({ userId }: { userId: string }): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { notes } = useAgentNotes(userId);
  const once = useOncePerFocus();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        testID="profile-memory"
        accessibilityRole="button"
        onPress={() => {
          once(() => {
            router.push('/memory');
          });
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.navRow, { borderColor: color.border }]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Text style={[styles.body, styles.navLabel, { color: color.text }]}>{t('profile.memory')}</Text>
        {notes === null ? null : (
          <Text style={[styles.sub, { color: color.textMuted }]}>{tp('profile.memory.count', notes.length)}</Text>
        )}
        <ChevronRight size={20} color={color.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

/** The AI switch: turning it off asks first, turning it on shows what is shared; consent goes only through `setAiConsent`. */
function CompanionSetting({ enabled, pending }: { enabled: boolean; pending: boolean }): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const { patchProfile } = useAuth();
  const [asking, setAsking] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const answer = async (next: boolean): Promise<void> => {
    setSaving(true);
    setFailed(false);
    const result = await setAiConsent(next, locale);
    setSaving(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    // Only the consent fields: the rest of the refetched row may predate a change made meanwhile.
    patchProfile({
      aiEnabled: result.value.aiEnabled,
      aiConsentAnsweredAt: result.value.aiConsentAnsweredAt,
      aiConsentVersion: result.value.aiConsentVersion,
    });
    setAsking(undefined);
    AccessibilityInfo.announceForAccessibility(t(result.value.aiEnabled ? 'profile.companion.on' : 'profile.companion.off'));
  };

  return (
    <>
      <SwitchRow
        testID="profile-ai-switch"
        title={t('profile.companion.switch')}
        sub={t('profile.companion.sub')}
        value={enabled}
        disabled={saving}
        onChange={(next) => {
          setFailed(false);
          setAsking(next);
        }}
      />
      {/* The switch shows what the server holds, so turning it off (a withdrawal) works while the AI is paused. */}
      {pending && asking === undefined ? (
        <Notice
          tone="info"
          title={t('consent.paused')}
          action={{
            label: t('companion.reconsent.open'),
            onPress: () => {
              router.push('/ai-consent');
            },
          }}
        />
      ) : null}
      {asking === undefined ? null : (
        <View style={[styles.confirm, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>
            {t(asking ? 'profile.companion.confirmOn' : 'profile.companion.confirmOff')}
          </Text>
          {/* Turning it on records the same AI text as the consent screen, so it shows that text's facts and its policy. */}
          {asking ? (
            <>
              <Text style={[styles.body, { color: color.text }]}>{t('consent.sent.body')}</Text>
              <Text style={[styles.body, { color: color.text }]}>{t('consent.transfer')}</Text>
              <TextLink
                testID="profile-ai-policy"
                label={t('consent.policy_link')}
                role="link"
                onPress={() => {
                  Linking.openURL(policyUrl(locale, 'ai')).catch(() => undefined);
                }}
              />
            </>
          ) : null}
          {failed ? <Notice tone="danger" title={t('consent.error')} /> : null}
          <Button
            testID="profile-ai-confirm"
            label={t(asking ? 'consent.accept' : 'common.confirm')}
            loading={saving}
            loadingLabel={t('common.saving')}
            onPress={() => {
              void answer(asking);
            }}
          />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            disabled={saving}
            onPress={() => {
              setAsking(undefined);
              setFailed(false);
            }}
          />
        </View>
      )}
    </>
  );
}

/**
 * Sign out, asking first while records have not uploaded: the purge keeps them on this phone, but only this
 * account signing back in here can send them.
 */
function SignOutButton(): React.JSX.Element {
  const { t, tp } = useI18n();
  const { color } = useTheme();
  const signOut = useSignOut();
  const { pending, failed } = useSyncState();
  const [asking, setAsking] = useState(false);
  const waiting = pending + failed;

  return (
    <>
      {signOut.error === undefined ? null : <Notice tone="danger" title={t(authErrorMessage(signOut.error))} />}
      {asking && waiting > 0 ? (
        <View style={[styles.confirm, { backgroundColor: color.surface, borderColor: color.border }]}>
          <Text style={[styles.body, { color: color.text }]}>{tp('profile.signOut.pending', waiting)}</Text>
          <Button
            label={t('profile.signOut')}
            loading={signOut.signingOut}
            loadingLabel={t('common.loading')}
            onPress={signOut.signOut}
          />
          <Button
            variant="secondary"
            label={t('common.cancel')}
            disabled={signOut.signingOut}
            onPress={() => {
              setAsking(false);
            }}
          />
        </View>
      ) : (
        <Button
          variant="secondary"
          label={t('profile.signOut')}
          loading={signOut.signingOut}
          loadingLabel={t('common.loading')}
          onPress={() => {
            if (waiting > 0) setAsking(true);
            else signOut.signOut();
          }}
        />
      )}
    </>
  );
}

export default function Profile(): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const { profile, email, userId } = useAuth();
  const { preference, setPreference } = useLocalePreference();
  const { change, error } = useProfileChange();
  const bottomInset = useTabBarInset();

  // The tabs mount only with a profile; this keeps the types honest.
  if (profile === null) return null;

  return (
    <Screen bottomInset={bottomInset}>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('profile.title')}
      </Text>

      {error === undefined ? null : <Notice tone="danger" title={t(errorKey(error))} />}

      <Section title={t('profile.preferences')}>
        <View style={styles.setting}>
          <Text style={[styles.body, { color: color.text }]}>{t('profile.language')}</Text>
          <ChoiceGroup
            label={t('profile.language')}
            layout="list"
            value={preference}
            choices={LANGUAGES.map((value) => ({ value, label: t(`profile.language.${value}`) }))}
            onChange={(next) => {
              void setPreference(next);
              void change({ language: next === 'system' ? null : next });
            }}
          />
        </View>

        <View style={styles.setting}>
          <Text style={[styles.body, { color: color.text }]}>{t('profile.appearance')}</Text>
          <Text style={[styles.sub, { color: color.textMuted }]}>{t('profile.appearance.note')}</Text>
          <ChoiceGroup
            label={t('profile.appearance')}
            layout="segmented"
            value={profile.theme}
            choices={APPEARANCES.map((value) => ({ value, label: t(`profile.appearance.${value}`) }))}
            onChange={(theme) => {
              void change({ theme });
            }}
          />
          <Text style={[styles.help, { color: color.textMuted }]}>{t('profile.appearance.systemHelp')}</Text>
        </View>

        <SwitchRow
          title={t('profile.reduceMotion')}
          value={profile.reduceMotion}
          onChange={(reduceMotion) => {
            void change({ reduceMotion });
          }}
        />
        <SwitchRow
          title={t('profile.period')}
          sub={t('profile.period.sub')}
          value={profile.trackPeriod}
          onChange={(trackPeriod) => {
            void change({ trackPeriod });
          }}
        />
        {userId === null ? null : <CabinetRow userId={userId} />}
      </Section>

      {userId === null ? null : (
        <Section title={t('profile.sec.notif')}>
          <NotificationSettings key={userId} userId={userId} />
        </Section>
      )}

      <Section title={t('profile.companion')}>
        <CompanionSetting enabled={profile.aiEnabled} pending={needsAiReconsent(profile)} />
        {userId === null ? null : <MemoryRow key={userId} userId={userId} />}
      </Section>

      <Section title={t('profile.account')}>
        {email === null ? null : (
          <Text style={[styles.sub, { color: color.textMuted }]}>{t('profile.signedInAs', { email })}</Text>
        )}
        <SignOutButton />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  section: { gap: space[3] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  setting: { gap: space[2] },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  sub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  help: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight, borderTopWidth: 1, borderBottomWidth: 1 },
  navLabel: { flex: 1 },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  confirm: { gap: space[3], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
});
