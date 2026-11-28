import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { translate } from '../../i18n';
import { PremiumGate } from '../PremiumGate';
import { usePremium } from '../usePremium';

jest.mock('../usePremium', () => ({ usePremium: jest.fn() }));

const mockedUsePremium = jest.mocked(usePremium);

test('premium sees the children', async () => {
  mockedUsePremium.mockReturnValue({ premium: true, loading: false });
  await render(<PremiumGate><Text>locked thing</Text></PremiumGate>);
  expect(screen.getByText('locked thing')).toBeTruthy();
  expect(screen.queryByText(translate('en', 'premium.title'))).toBeNull();
});

test('everyone else sees the invitation, not the children', async () => {
  mockedUsePremium.mockReturnValue({ premium: false, loading: false });
  await render(<PremiumGate><Text>locked thing</Text></PremiumGate>);
  expect(screen.queryByText('locked thing')).toBeNull();
  expect(screen.getByText(translate('en', 'premium.title'))).toBeTruthy();
  expect(screen.getByText(translate('en', 'premium.body'))).toBeTruthy();
});

test('while loading with no answer, neither the children nor the invitation show', async () => {
  mockedUsePremium.mockReturnValue({ premium: false, loading: true });
  await render(<PremiumGate><Text>locked thing</Text></PremiumGate>);
  expect(screen.queryByText('locked thing')).toBeNull();
  expect(screen.queryByText(translate('en', 'premium.title'))).toBeNull();
});

test('a cached yes shows the children even while the answer is refreshing', async () => {
  mockedUsePremium.mockReturnValue({ premium: true, loading: true });
  await render(<PremiumGate><Text>locked thing</Text></PremiumGate>);
  expect(screen.getByText('locked thing')).toBeTruthy();
});
