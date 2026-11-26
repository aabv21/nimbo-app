import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { I18nProvider, useLocalePreference } from '../I18nProvider';
import { useI18n } from '../index';

beforeEach(() => {
  kvRemove('locale-preference');
});

function Probe(): React.JSX.Element {
  const { locale, t } = useI18n();
  const { preference, setPreference } = useLocalePreference();
  return (
    <>
      <Text testID="locale">{locale}</Text>
      <Text testID="preference">{preference}</Text>
      <Text testID="today">{t('tabs.today')}</Text>
      <Text testID="set-pt" onPress={() => void setPreference('pt')}>
        set-pt
      </Text>
    </>
  );
}

test('defaults to system, resolving en from the mocked device locale', async () => {
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('preference')).toHaveTextContent('system');
  expect(screen.getByTestId('locale')).toHaveTextContent('en');
  expect(screen.getByTestId('today')).toHaveTextContent('Today');
});

test('setPreference("pt") switches translations and persists the value', async () => {
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByTestId('set-pt'));
  expect(screen.getByTestId('locale')).toHaveTextContent('pt');
  expect(screen.getByTestId('today')).toHaveTextContent('Hoje');
  expect(kvGet('locale-preference')).toBe('pt');
});

test('a stored preference is read on mount', async () => {
  kvSet('locale-preference', 'es');
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('today')).toHaveTextContent('Hoy');
});

test('an unknown stored preference falls back to system', async () => {
  kvSet('locale-preference', 'fr');
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByTestId('preference')).toHaveTextContent('system');
});
