import { fireEvent, render, screen } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { Linking } from 'react-native';

import { translate } from '../../i18n';
import { EmergencyCallRow } from '../EmergencyCall';

jest.mock('expo-localization', () => ({ getLocales: jest.fn() }));

const openURL = jest.spyOn(Linking, 'openURL');

function region(code: string | null): void {
  jest.mocked(getLocales).mockReturnValue([
    { languageTag: 'es-BR', languageCode: 'es', regionCode: code, currencyCode: null } as ReturnType<typeof getLocales>[number],
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  openURL.mockResolvedValue(undefined);
});

test('the phone\'s region picks the number, whatever the language, and the button dials it', async () => {
  region('BR');
  await render(<EmergencyCallRow testID="call" />);
  await fireEvent.press(screen.getByTestId('call'));
  expect(openURL).toHaveBeenCalledWith('tel:192');
});

test('with no known number, the local-emergency line shows (in the phone language) and the button opens the dialer', async () => {
  region(null);
  await render(<EmergencyCallRow testID="call" />);
  expect(screen.getByText(translate('es', 'redflag.unknown'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: translate('es', 'redflag.open_dialer') }));
  expect(openURL).toHaveBeenCalledWith('tel:');
});
