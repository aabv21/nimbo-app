import { render, screen } from '@testing-library/react-native';

import { translate } from '../../i18n';
import type { Evidence } from '../contract';
import { EvidenceChips, hasRecords } from '../EvidenceChips';

const insight = (episodeIds: string[]): Evidence => ({ ref: 'i1', source: 'insight', count: 12, of: 30, episodeIds, doseIds: [] });

test('an insight resting on no attack shows no chip, so it can never open an empty sheet', async () => {
  const counted: Evidence = { ref: 'r1', source: 'episodes', count: 0, of: null, episodeIds: [], doseIds: [] };
  expect(hasRecords(insight([]))).toBe(false);
  expect(hasRecords(insight(['a']))).toBe(true);
  expect(hasRecords(counted)).toBe(true);
  await render(<EvidenceChips evidence={[insight([])]} onOpen={jest.fn()} />);
  expect(screen.toJSON()).toBeNull();
  await render(<EvidenceChips evidence={[insight(['a'])]} onOpen={jest.fn()} />);
  expect(screen.getByRole('button', { name: translate('en', 'evidence.insight', { count: 12, of: 30 }) })).toBeTruthy();
});
