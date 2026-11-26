import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { isGoogleSignInConfigured, signInWithApple, signInWithGoogle } from './authService';
import type { Result } from './authService';
import type { AuthErrorKey } from './errors';

/**
 * Google wherever the build has its client ids, Apple on iPhone (every iOS version the app supports
 * has it); a session from either is picked up by `AuthProvider`. With neither, it renders nothing,
 * not even the "or" above them.
 */
export function SocialButtons({ onError }: { onError: (error: AuthErrorKey) => void }): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const [busy, setBusy] = useState(false);

  const run = async (signIn: () => Promise<Result>): Promise<void> => {
    setBusy(true);
    try {
      const result = await signIn();
      // A dismissed sheet is the user's choice, not a failure to report.
      if (!result.ok && result.error !== 'auth.error.cancelled') onError(result.error);
    } finally {
      setBusy(false);
    }
  };

  const google = isGoogleSignInConfigured();
  const apple = Platform.OS === 'ios';
  if (!google && !apple) return null;

  return (
    <View style={styles.group}>
      <Text style={[styles.or, { color: color.textMuted }]}>{t('auth.or')}</Text>
      {google ? (
        <Button
          variant="secondary"
          label={t('auth.signIn.google')}
          disabled={busy}
          onPress={() => {
            void run(() => signInWithGoogle());
          }}
        />
      ) : null}
      {apple ? (
        <Button
          variant="secondary"
          label={t('auth.signIn.apple')}
          disabled={busy}
          onPress={() => {
            void run(() => signInWithApple());
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[2] },
  or: { textAlign: 'center', fontFamily: fonts.body, fontSize: type.label },
});
