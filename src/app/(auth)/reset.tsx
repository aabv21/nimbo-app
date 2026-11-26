import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native';

import { confirmPasswordReset, requestPasswordReset } from '../../auth/authService';
import { authErrorMessage } from '../../auth/errors';
import type { AuthErrorKey } from '../../auth/errors';
import { isValidEmail } from '../../auth/validation';
import { useI18n } from '../../i18n';
import { BackButton } from '../../ui/BackButton';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Screen } from '../../ui/Screen';
import { fonts, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';
import { TextField } from '../../ui/TextField';

const CODE_LENGTH = 6;
const MIN_PASSWORD_LENGTH = 8;

export default function Reset(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const send = async (): Promise<void> => {
    const trimmed = email.trim();
    setError(undefined);
    setEmailInvalid(!isValidEmail(trimmed));
    if (!isValidEmail(trimmed)) return;
    setSubmitting(true);
    try {
      const result = await requestPasswordReset(trimmed);
      if (result.ok) setStep('confirm');
      else setError(result.error);
    } finally {
      setSubmitting(false);
    }
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    if (code.length !== CODE_LENGTH) {
      setError('auth.error.invalidCode');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError('auth.error.weakPassword');
      return;
    }
    setSubmitting(true);
    try {
      // The recovery session signs the user in, so the root layout usually swaps this stack out before this shows.
      const result = await confirmPasswordReset(email.trim(), code, password);
      if (result.ok) setStep('done');
      else setError(result.error);
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
            if (router.canGoBack()) router.back();
            else router.replace('/sign-in');
          }}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>{t('auth.reset.title')}</Text>
        {step === 'request' ? (
          <>
            <Text style={[styles.body, { color: color.text }]}>{t('auth.reset.body')}</Text>
            <TextField
              label={t('auth.reset.email')}
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.emailPlaceholder')}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              {...(emailInvalid ? { error: t('auth.error.emailInvalid') } : {})}
            />
            {error === undefined ? null : <Notice tone="danger" title={t(authErrorMessage(error))} />}
            <Button
              label={t('auth.reset.send')}
              onPress={() => {
                void send();
              }}
              loading={submitting}
              loadingLabel={t('common.loading')}
            />
          </>
        ) : null}
        {step === 'confirm' ? (
          <>
            <Text style={[styles.body, { color: color.text }]}>{t('auth.confirm.body', { email: email.trim() })}</Text>
            <TextField
              label={t('auth.reset.code')}
              value={code}
              onChangeText={(text) => {
                setCode(text.replace(/\D/g, '').slice(0, CODE_LENGTH));
              }}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={CODE_LENGTH}
            />
            <TextField
              label={t('auth.reset.newPassword')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              help={t('auth.signUp.passwordHint')}
            />
            {error === undefined ? null : <Notice tone="danger" title={t(error === 'auth.error.invalidCode' ? 'auth.reset.error.invalid' : authErrorMessage(error))} />}
            <Button
              label={t('auth.reset.submit')}
              onPress={() => {
                void save();
              }}
              loading={submitting}
              loadingLabel={t('common.loading')}
            />
          </>
        ) : null}
        {step === 'done' ? (
          <>
            <Text style={[styles.body, { color: color.text }]}>{t('auth.reset.done')}</Text>
            <Button
              label={t('common.continue')}
              onPress={() => {
                router.replace('/');
              }}
            />
          </>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 35 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
