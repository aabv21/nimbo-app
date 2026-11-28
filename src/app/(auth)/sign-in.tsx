import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { resendSignUpCode, signInWithEmail } from '../../auth/authService';
import { authErrorMessage } from '../../auth/errors';
import type { AuthErrorKey } from '../../auth/errors';
import { SocialButtons } from '../../auth/SocialButtons';
import { isValidEmail } from '../../auth/validation';
import { useI18n } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { BackButton } from '../../ui/BackButton';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { fonts, space, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';
import { TextField } from '../../ui/TextField';
import { TextLink } from '../../ui/TextLink';

export default function SignIn(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<MessageKey | undefined>(undefined);
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);
  const [pendingEmail, setPendingEmail] = useState<string | undefined>(undefined);
  // The address a code was last sent to from here, so the code screen opens saying it is on its way.
  const [codeSentTo, setCodeSentTo] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const openCodeScreen = (address: string): void => {
    router.push({ pathname: '/confirm-email', params: address === codeSentTo ? { email: address, sent: '1' } : { email: address } });
  };

  const resend = async (address: string): Promise<void> => {
    const result = await resendSignUpCode(address);
    if (!result.ok) return;
    setCodeSentTo(address);
    router.push({ pathname: '/confirm-email', params: { email: address, sent: '1' } });
  };

  const submit = async (): Promise<void> => {
    const trimmed = email.trim();
    setError(undefined);
    setPendingEmail(undefined);
    if (!isValidEmail(trimmed)) {
      setEmailError('auth.error.emailInvalid');
      return;
    }
    setEmailError(undefined);
    setSubmitting(true);
    try {
      // On success `AuthProvider` flips the status and the root layout moves the user on.
      const result = await signInWithEmail(trimmed, password);
      if (result.ok) return;
      if (result.error === 'auth.error.emailNotConfirmed') {
        // Signed up but never entered the code: finish that step instead of showing a generic error.
        setPendingEmail(trimmed);
        openCodeScreen(trimmed);
      }
      setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        {/* The landing screen of a signed-out launch has nowhere to go back to. */}
        {router.canGoBack() ? (
          <BackButton
            label={t('common.back')}
            onPress={() => {
              router.back();
            }}
          />
        ) : null}
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('auth.signIn.title')}</Text>
        <TextField
          label={t('auth.signIn.email')}
          value={email}
          onChangeText={setEmail}
          placeholder={t('auth.emailPlaceholder')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          {...(emailError === undefined ? {} : { error: t(emailError) })}
        />
        <View style={styles.passwordGroup}>
          <TextField
            label={t('auth.signIn.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            onSubmitEditing={() => {
              void submit();
            }}
          />
          <TextLink
            label={t('auth.showPassword')}
            onPress={() => {
              setShowPassword((shown) => !shown);
            }}
          />
        </View>
        {error === undefined ? null : error === 'auth.error.emailNotConfirmed' && pendingEmail !== undefined ? (
          <Notice
            tone="warning"
            title={t(authErrorMessage(error))}
            action={{
              label: t('auth.confirm.resend'),
              onPress: () => {
                void resend(pendingEmail);
              },
            }}
          />
        ) : (
          <Notice tone="danger" title={t(authErrorMessage(error))} />
        )}
        <Button
          label={t('auth.signIn.submit')}
          onPress={() => {
            void submit();
          }}
          loading={submitting}
          loadingLabel={t('common.loading')}
        />
        <TextLink
          label={t('auth.signIn.forgot')}
          onPress={() => {
            router.push('/reset');
          }}
        />
        <SocialButtons onError={setError} />
        <View style={styles.footer}>
          <Text style={[styles.muted, { color: color.textMuted }]}>{t('auth.signIn.noAccount')}</Text>
          <TextLink
            label={t('auth.signUp.submit')}
            onPress={() => {
              router.replace('/sign-up');
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
  passwordGroup: { gap: 0 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' },
  muted: { fontFamily: fonts.body, fontSize: type.label },
});
