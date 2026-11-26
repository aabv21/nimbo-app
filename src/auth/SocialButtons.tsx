import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useI18n } from '../i18n';
import { Button } from '../ui/Button';
import { space } from '../ui/theme';
import { signInWithApple, signInWithGoogle } from './authService';
import type { Result } from './authService';
import type { AuthErrorKey } from './errors';

/** Google everywhere, Apple on iPhone; a session from either is picked up by `AuthProvider`. */
export function SocialButtons({ onError }: { onError: (error: AuthErrorKey) => void }): React.JSX.Element {
  const { t } = useI18n();
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

  return (
    <View style={styles.group}>
      <Button
        variant="secondary"
        label={t('auth.signIn.google')}
        disabled={busy}
        onPress={() => {
          void run(() => signInWithGoogle());
        }}
      />
      {Platform.OS === 'ios' ? (
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

const styles = StyleSheet.create({ group: { gap: space[2] } });
