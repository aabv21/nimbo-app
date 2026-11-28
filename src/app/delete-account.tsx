// "Delete my account": says what goes, offers the export first, and needs an explicit acknowledgement before the only
// filled button, the danger one. The flow: docs/app.md#account-deletion-on-the-phone.
import { router, Stack } from 'expo-router';
import { Trash2 } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { BackHandler, StyleSheet, Text, View } from 'react-native';

import { usePrivacyActions } from '../account/usePrivacyActions';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { BackButton } from '../ui/BackButton';
import { Button } from '../ui/Button';
import { CheckRow } from '../ui/CheckRow';
import { DockedScreen } from '../ui/DockedScreen';
import { Notice } from '../ui/Notice';
import { TextLink } from '../ui/TextLink';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';

export default function DeleteAccount(): React.JSX.Element | null {
  const { userId } = useAuth();
  // Registered only for a signed-in account; a deletion that ends signs out, and the gate takes this screen away.
  if (userId === null) return null;
  return <DeleteScreen key={userId} userId={userId} />;
}

function DeleteScreen({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { deleting } = usePrivacyActions(userId);
  const [understood, setUnderstood] = useState(false);

  // While the deletion runs the screen can't be left (back button, swipe or Android back), so its result is always seen.
  useEffect(() => {
    if (!deleting.busy) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      subscription.remove();
    };
  }, [deleting.busy]);

  return (
    <DockedScreen
      dock={
        <View style={styles.dockRow}>
          <Button
            variant="secondary"
            label={t('common.cancel')}
            disabled={deleting.busy}
            onPress={() => {
              router.back();
            }}
          />
          <Button
            testID="delete-run"
            variant="danger"
            label={t('delete.cta')}
            icon={Trash2}
            disabled={!understood}
            loading={deleting.busy}
            loadingLabel={t('delete.busy')}
            onPress={deleting.run}
            style={styles.grow}
          />
        </View>
      }
    >
      <Stack.Screen options={{ gestureEnabled: !deleting.busy }} />
      <View testID="screen-profile-delete">
        <BackButton
          testID="delete-back"
          disabled={deleting.busy}
          label={t('common.back')}
          onPress={() => {
            router.back();
          }}
        />
      </View>
      <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
        {t('delete.title')}
      </Text>
      <Text style={[styles.body, { color: color.text }]}>{t('delete.body')}</Text>
      <TextLink
        testID="delete-export-first"
        label={t('delete.export_first')}
        disabled={deleting.busy}
        onPress={() => {
          router.push('/export');
        }}
      />
      <CheckRow testID="delete-confirm" label={t('delete.confirm')} checked={understood} onChange={setUnderstood} />
      {deleting.error === undefined ? null : <Notice tone="danger" title={t(deleting.error)} />}
    </DockedScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  dockRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  grow: { flexGrow: 1 },
});
