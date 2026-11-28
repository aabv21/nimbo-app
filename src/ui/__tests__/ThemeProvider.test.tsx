import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import type { ColorSchemeName } from 'react-native';

import { READY_PROFILE, resetAuth, setAuth } from '../../test/authMock';
import { useMotion } from '../motion';
import { ThemeProvider, useTheme } from '../ThemeProvider';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));

let mockScheme: ColorSchemeName = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

function Probe(): React.JSX.Element {
  const theme = useTheme();
  const motion = useMotion();
  return (
    <>
      <Text testID="theme">{theme.name}</Text>
      <Text testID="bg">{theme.color.bg}</Text>
      <Text testID="motion">{motion.level}</Text>
      <Text
        onPress={() => {
          theme.forceDim(true);
        }}
      >
        start crisis
      </Text>
      <Text
        onPress={() => {
          theme.forceDim(false);
        }}
      >
        end crisis
      </Text>
    </>
  );
}

async function renderProbe(): Promise<void> {
  await render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  mockScheme = 'light';
  resetAuth();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('Automatic follows the phone: Day when light, Dark when dark', async () => {
  setAuth({ profile: { ...READY_PROFILE, theme: 'system' } });
  await renderProbe();
  expect(screen.getByTestId('theme')).toHaveTextContent('day');

  mockScheme = 'dark';
  await renderProbe();
  expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  expect(screen.getByTestId('bg')).toHaveTextContent('#151b17');
});

test('a fixed choice ignores the phone', async () => {
  mockScheme = 'dark';
  setAuth({ profile: { ...READY_PROFILE, theme: 'day' } });
  await renderProbe();
  expect(screen.getByTestId('theme')).toHaveTextContent('day');
});

test('signed out, the app follows the phone whatever a cached profile said', async () => {
  mockScheme = 'dark';
  resetAuth({ status: 'signedOut', userId: null, profile: { ...READY_PROFILE, theme: 'dim' } });
  await renderProbe();
  expect(screen.getByTestId('theme')).toHaveTextContent('dark');
});

test('crisis mode forces Dim and gives the choice back when it ends', async () => {
  setAuth({ profile: { ...READY_PROFILE, theme: 'day' } });
  await renderProbe();

  await fireEvent.press(screen.getByText('start crisis'));
  expect(screen.getByTestId('theme')).toHaveTextContent('dim');
  expect(screen.getByTestId('motion')).toHaveTextContent('subtle');

  await fireEvent.press(screen.getByText('end crisis'));
  expect(screen.getByTestId('theme')).toHaveTextContent('day');
});

test('the in-app reduce-motion switch makes every motion a fade', async () => {
  setAuth({ profile: { ...READY_PROFILE, reduceMotion: true } });
  await renderProbe();
  expect(screen.getByTestId('motion')).toHaveTextContent('fade');
});

test('the OS reduce-motion setting makes every motion a fade', async () => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  await renderProbe();
  expect(await screen.findByText('fade')).toBeOnTheScreen();
});
