import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { Chip } from '../../checkin/Chip';
import { packs } from '../../condition';
import { isMessageKey, useI18n } from '../../i18n';
import { OnboardingStep, SETUP_STEPS } from '../../onboarding/OnboardingStep';
import { useProfileChange } from '../../profile/useProfileChange';
import { Button } from '../../ui/Button';
import { space } from '../../ui/theme';

function next(): void {
  router.push('/welcome/priority');
}

// Only pack keys are offered, so the server's catalog check on `known_triggers` always passes.
export default function Triggers(): React.JSX.Element {
  const { t } = useI18n();
  const { profile } = useAuth();
  const { change } = useProfileChange();
  // In the order picked, as the user ranks them.
  const [picked, setPicked] = useState<readonly string[]>(() => profile?.knownTriggers ?? []);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (): Promise<void> => {
    setFailed(false);
    setSaving(true);
    try {
      if (await change({ knownTriggers: picked })) next();
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingStep
      done={2}
      total={SETUP_STEPS}
      onSkip={next}
      title={t('onb.triggers.title')}
      lede={t('onb.triggers.lede')}
      error={failed ? t('consent.error') : undefined}
      dock={
        <Button
          label={t('common.next')}
          loading={saving}
          loadingLabel={t('common.saving')}
          onPress={() => {
            void save();
          }}
        />
      }
    >
      <View style={styles.chips}>
        {packs.migraine.triggers.map((item) => {
          const selected = picked.includes(item.key);
          return (
            <Chip
              key={item.key}
              role="checkbox"
              label={isMessageKey(item.labelKey) ? t(item.labelKey) : item.key}
              selected={selected}
              onPress={() => {
                setPicked(selected ? picked.filter((key) => key !== item.key) : [...picked, item.key]);
              }}
            />
          );
        })}
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
});
