// The single most urgent overuse notice for the month, shown on the cabinet and on Today.
import { router } from 'expo-router';

import type { MedicationClass, OveruseEntry, OveruseStatus } from '../condition';
import { useI18n } from '../i18n';
import { Notice } from '../ui/Notice';
import { classLabelKey } from './medicationLabels';

type Scope = MedicationClass | 'combined';

const RANK = { ok: 0, warn: 1, limit: 2 } as const;

function ratio(entry: OveruseEntry): number {
  return entry.limit === null ? 0 : entry.days / entry.limit;
}

/** A `limit` beats a `warn`; at one level a class beats the combined count, and the fullest class wins. */
export function mostUrgent(status: OveruseStatus): { scope: Scope; entry: OveruseEntry } | null {
  let best: { scope: Scope; entry: OveruseEntry } | null = null;
  const consider = (scope: Scope, entry: OveruseEntry): void => {
    if (entry.level === 'ok') return;
    if (best === null || RANK[entry.level] > RANK[best.entry.level] || (RANK[entry.level] === RANK[best.entry.level] && scope !== 'combined' && (best.scope === 'combined' || ratio(entry) > ratio(best.entry)))) {
      best = { scope, entry };
    }
  };
  for (const [medicationClass, entry] of Object.entries(status.byClass)) consider(medicationClass as MedicationClass, entry);
  consider('combined', status.combined);
  return best;
}

export function OveruseNotice({ status, daysLeft }: { status: OveruseStatus; daysLeft: number }): React.JSX.Element | null {
  const { t, tp } = useI18n();
  const urgent = mostUrgent(status);
  if (urgent === null) return null;
  const { scope, entry } = urgent;
  const params = { used: entry.days, limit: entry.limit ?? 0 };

  if (entry.level === 'limit') {
    return (
      <Notice
        tone="danger"
        title={t('overuse.limit.title', params)}
        body={t('overuse.limit.body', { limit: params.limit })}
        action={{
          label: t('overuse.limit.action'),
          onPress: () => {
            router.push('/history?filter=doses');
          },
        }}
      />
    );
  }
  const label = t(scope === 'combined' ? 'overuse.class.combined' : classLabelKey(scope));
  return <Notice tone="warning" title={t('overuse.warn.title', { ...params, class: label })} body={tp('overuse.warn.body', daysLeft, { left: daysLeft })} />;
}
