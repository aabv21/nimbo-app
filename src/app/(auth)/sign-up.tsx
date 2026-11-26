import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';

import { signUpWithEmail } from '../../auth/authService';
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
import { toHref } from '../../auth/routes';

const MIN_PASSWORD_LENGTH = 8;

export default function SignUp(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState<MessageKey | undefined>(undefined);
  const [passwordError, setPasswordError] = useState<MessageKey | undefined>(undefined);
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const trimmed = email.trim();
    setError(undefined);
    const emailProblem = isValidEmail(trimmed) ? undefined : 'auth.error.emailInvalid';
    const passwordProblem = password.length >= MIN_PASSWORD_LENGTH ? undefined : 'auth.signUp.error.weakPassword';
    setEmailError(emailProblem);
    setPasswordError(passwordProblem);
    if (emailProblem !== undefined || passwordProblem !== undefined) return;

    setSubmitting(true);
    try {
      const result = await signUpWithEmail(trimmed, password);
      if (!result.ok) {
        setError(result.error);
      } else if (result.needsConfirmation) {
        router.push(toHref({ pathname: '/confirm-email', params: { email: trimmed, sent: '1' } }));
      }
      // Without confirmation the session arrives through `AuthProvider` and the root layout moves on.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <BackButton
          label={t('common.back')}
          onPress={() => {
            router.replace(toHref('/sign-in'));
          }}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('auth.signUp.title')}</Text>
        <TextField
          label={t('auth.signUp.email')}
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
        <View>
          <TextField
            label={t('auth.signUp.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            help={t('auth.signUp.passwordHint')}
            {...(passwordError === undefined ? {} : { error: t(passwordError) })}
          />
          <TextLink
            label={t('auth.showPassword')}
            onPress={() => {
              setShowPassword((shown) => !shown);
            }}
          />
        </View>
        {error === undefined ? null : <Notice tone="danger" title={t(authErrorMessage(error))} />}
        <Button
          label={t('auth.signUp.submit')}
          onPress={() => {
            void submit();
          }}
          loading={submitting}
          loadingLabel={t('common.loading')}
        />
        <Text style={[styles.or, { color: color.textMuted }]}>{t('auth.or')}</Text>
        <SocialButtons onError={setError} />
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
  or: { textAlign: 'center', fontFamily: fonts.body, fontSize: type.label },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' },
  muted: { fontFamily: fonts.body, fontSize: type.label },
});
