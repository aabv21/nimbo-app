import { router } from 'expo-router';
import { useState } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { OnboardingStep, SETUP_STEPS } from '../../onboarding/OnboardingStep';
import type { Priority } from '../../profile/profileRepository';
import { useProfileChange } from '../../profile/useProfileChange';
import { Button } from '../../ui/Button';
import { ChoiceGroup } from '../../ui/ChoiceGroup';

const PRIORITIES: readonly Priority[] = ['fewer', 'triggers', 'overuse', 'logging'];

function next(): void {
  router.push('/welcome/medications');
}

// The answer orders Today's sections (`todaySections`).
export default function PriorityStep(): React.JSX.Element {
  const { t } = useI18n();
  const { profile } = useAuth();
  const { change } = useProfileChange();
  const [priority, setPriority] = useState<Priority | null>(() => profile?.priority ?? null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (): Promise<void> => {
    // Nothing chosen is the same as Skip.
    if (priority === null) {
      next();
      return;
    }
    setFailed(false);
    setSaving(true);
    try {
      if (await change({ priority })) next();
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <OnboardingStep
      done={3}
      total={SETUP_STEPS}
      onSkip={next}
      title={t('onb.priority.title')}
      lede={t('onb.priority.lede')}
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
      <ChoiceGroup
        layout="cards"
        label={t('onb.priority.title')}
        value={priority}
        onChange={setPriority}
        choices={PRIORITIES.map((value) => ({ value, label: t(`onb.priority.${value}`), sub: t(`onb.priority.${value}_sub`) }))}
      />
    </OnboardingStep>
  );
}
