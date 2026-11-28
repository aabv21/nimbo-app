// "Export my data": the server's copy of the account as a JSON file in the cache directory, shared through the share
// sheet. The flow: docs/app.md#account-deletion-on-the-phone.
import { router } from 'expo-router';
import { Download, Share2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { usePrivacyActions } from '../account/usePrivacyActions';
import { useAuth } from '../auth/AuthProvider';
import { useI18n } from '../i18n';
import { BackButton } from '../ui/BackButton';
import { Button } from '../ui/Button';
import { DockedScreen } from '../ui/DockedScreen';
import { Notice } from '../ui/Notice';
import { fonts, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';

export default function ExportData(): React.JSX.Element | null {
  const { userId } = useAuth();
  // Registered only for a signed-in account; keyed so a switch never shows the last account's file.
  if (userId === null) return null;
  return <ExportScreen key={userId} userId={userId} />;
}

function ExportScreen({ userId }: { userId: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const { exporting } = usePrivacyActions(userId);
  const ready = exporting.fileUri !== null;

  return (
    <DockedScreen
      dock={
        ready ? (
          <Button testID="export-share" label={t('export.share')} icon={Share2} onPress={exporting.share} />
        ) : (
          <Button
            testID="export-run"
            label={t('profile.export')}
            icon={Download}
            loading={exporting.busy}
            loadingLabel={t('export.busy')}
            onPress={exporting.run}
          />
        )
      }
    >
      <View testID="screen-profile-export" style={styles.top}>
        <BackButton
          testID="export-back"
          label={t('common.back')}
          onPress={() => {
            router.back();
          }}
        />
        <Text accessibilityRole="header" style={[styles.title, { color: color.text }]}>
          {t('export.title')}
        </Text>
      </View>
      <Text style={[styles.body, { color: color.text }]}>{t('export.body')}</Text>
      {exporting.error === undefined ? null : <Notice tone="danger" title={t(exporting.error)} />}
      {ready ? <Notice testID="export-ready" tone="info" title={t('export.ready')} /> : null}
    </DockedScreen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  title: { flex: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 28 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
