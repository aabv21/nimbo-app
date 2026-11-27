import { AtkinsonHyperlegibleNext_400Regular } from '@expo-google-fonts/atkinson-hyperlegible-next/400Regular';
import { AtkinsonHyperlegibleNext_600SemiBold } from '@expo-google-fonts/atkinson-hyperlegible-next/600SemiBold';
import { AtkinsonHyperlegibleNext_700Bold } from '@expo-google-fonts/atkinson-hyperlegible-next/700Bold';
import { Literata_400Regular } from '@expo-google-fonts/literata/400Regular';
import { Literata_400Regular_Italic } from '@expo-google-fonts/literata/400Regular_Italic';
import { Literata_600SemiBold } from '@expo-google-fonts/literata/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { authErrorMessage } from '../auth/errors';
import { nextRoute } from '../auth/gate';
import { useSignOut } from '../auth/useSignOut';
import { useI18n } from '../i18n';
import { I18nProvider } from '../i18n/I18nProvider';
import { SyncProvider } from '../lib/sync/SyncProvider';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { Screen } from '../ui/Screen';
import { fonts, space, type } from '../ui/theme';
import { ThemeProvider } from '../ui/ThemeProvider';
import { useTheme } from '../ui/themeContext';

// The splash stays until the fonts are in, so no screen paints in the system font first.
void SplashScreen.preventAutoHideAsync();

/**
 * Shown in place of the stack while the session or the profile is unknown; there is no route for it.
 * A signed-in user whose profile cannot be read (offline with no cache, or no row) can retry or sign out.
 */
function LoadingView(): React.JSX.Element {
  const { status, refreshProfile } = useAuth();
  const { t } = useI18n();
  const { color } = useTheme();
  const signOut = useSignOut();
  const [retrying, setRetrying] = useState(false);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await refreshProfile();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Screen scroll={false} contentStyle={styles.center}>
      <Text accessibilityRole="progressbar" style={[styles.loading, { color: color.textMuted }]}>
        {t('common.loading')}
      </Text>
      {status === 'signedIn' ? (
        <View style={styles.actions}>
          {signOut.error === undefined ? null : <Notice tone="danger" title={t(authErrorMessage(signOut.error))} />}
          <Button
            variant="secondary"
            label={t('error.retry')}
            loading={retrying}
            loadingLabel={t('common.loading')}
            disabled={signOut.signingOut}
            onPress={() => {
              void retry();
            }}
          />
          <Button
            variant="secondary"
            label={t('profile.signOut')}
            loading={signOut.signingOut}
            loadingLabel={t('common.loading')}
            disabled={retrying}
            onPress={signOut.signOut}
          />
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Registers only the screens the account state allows (`Stack.Protected`), so a deep link to a screen
 * the user may not reach never mounts it: the landing route forwards to the one that is.
 */
function GatedStack(): React.JSX.Element {
  const auth = useAuth();
  const { color } = useTheme();
  const target = nextRoute(auth);

  if (target === '/loading') {
    return <LoadingView />;
  }
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={target === '/sign-in'}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={target === '/welcome/boundary' || target === '/welcome/ai-consent'}>
        <Stack.Screen name="welcome" />
      </Stack.Protected>
      <Stack.Protected guard={target === '/today'}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { fontFamily: fonts.body, fontSize: type.body },
  actions: { alignSelf: 'stretch', gap: space[2] },
});

export default function RootLayout(): React.JSX.Element | null {
  const [loaded, error] = useFonts({
    Literata_400Regular,
    Literata_400Regular_Italic,
    Literata_600SemiBold,
    AtkinsonHyperlegibleNext_400Regular,
    AtkinsonHyperlegibleNext_600SemiBold,
    AtkinsonHyperlegibleNext_700Bold,
  });
  // A font that fails to load falls back to the system face rather than holding the app.
  const ready = loaded || error !== null;

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <AuthProvider>
      <SyncProvider>
        <I18nProvider>
          <ThemeProvider>
            <GatedStack />
          </ThemeProvider>
        </I18nProvider>
      </SyncProvider>
    </AuthProvider>
  );
}
