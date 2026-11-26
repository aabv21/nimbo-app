import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { confirmSignUp, resendSignUpCode } from '../../auth/authService';
import { authErrorMessage } from '../../auth/errors';
import type { AuthErrorKey } from '../../auth/errors';
import { useI18n } from '../../i18n';
import { BackButton } from '../../ui/BackButton';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { CodeBoxes } from '../../ui/CodeBoxes';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';
import { TextLink } from '../../ui/TextLink';
import { toHref } from '../../auth/routes';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 30;

function clock(seconds: number): string {
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function ConfirmEmail(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const email = params.email ?? '';
  // Arriving from sign-up, a code is already on its way; from sign-in, none was sent yet.
  const [cooldown, setCooldown] = useState(params.sent === '1' ? RESEND_COOLDOWN_SECONDS : 0);
  const [code, setCode] = useState('');
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);
  const [resent, setResent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => {
      setCooldown((seconds) => seconds - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [cooldown]);

  const verify = async (): Promise<void> => {
    setError(undefined);
    setResent(false);
    if (code.length !== CODE_LENGTH) {
      setError('auth.error.invalidCode');
      return;
    }
    setSubmitting(true);
    try {
      // On success `AuthProvider` receives the session and the root layout moves the user on.
      const result = await confirmSignUp(email, code);
      if (!result.ok) setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async (): Promise<void> => {
    setError(undefined);
    const result = await resendSignUpCode(email);
    if (result.ok) {
      setResent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      setError(result.error);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <BackButton
          label={t('common.back')}
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace(toHref('/sign-in'));
          }}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('auth.confirm.title')}</Text>
        <Text style={[styles.body, { color: color.text }]}>{t('auth.confirm.body', { email })}</Text>
        <CodeBoxes
          label={t('auth.confirm.code')}
          value={code}
          length={CODE_LENGTH}
          onChangeText={(text) => {
            setCode(text.replace(/\D/g, '').slice(0, CODE_LENGTH));
          }}
        />
        <Text style={[styles.muted, { color: color.textMuted }]}>{t('auth.confirm.spam')}</Text>
        {error === undefined ? null : <Notice tone="danger" title={t(authErrorMessage(error))} />}
        {resent ? <Text style={[styles.body, { color: color.textMuted }]}>{t('auth.confirm.resent')}</Text> : null}
        <Button
          label={t('auth.confirm.submit')}
          onPress={() => {
            void verify();
          }}
          loading={submitting}
          loadingLabel={t('common.loading')}
        />
        <TextLink
          label={cooldown > 0 ? t('auth.confirm.resendIn', { time: clock(cooldown) }) : t('auth.confirm.resend')}
          disabled={cooldown > 0}
          onPress={() => {
            void resend();
          }}
        />
        {/* With confirmations on, signing up an already-confirmed email sends no code, so say where to go. */}
        <View style={styles.footer}>
          <Text style={[styles.muted, { color: color.textMuted }]}>{t('auth.signUp.haveAccount')}</Text>
          <TextLink
            label={t('auth.signIn.title')}
            onPress={() => {
              router.replace(toHref('/sign-in'));
            }}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' },
  muted: { fontFamily: fonts.body, fontSize: type.label },
});
