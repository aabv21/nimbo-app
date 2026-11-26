import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { Button } from '../Button';

test('a button is at least 48 pt tall and its label can wrap', async () => {
  await render(<Button label="Aceitar e continuar com o acompanhamento" onPress={() => {}} />);
  const button = screen.getByRole('button');
  expect(StyleSheet.flatten(button.props.style as StyleProp<ViewStyle>)?.minHeight).toBeGreaterThanOrEqual(48);
  expect(screen.getByText(/Aceitar/).props.numberOfLines).toBeUndefined();
});

test('a disabled button reports its state to assistive technology', async () => {
  await render(<Button label="Next" onPress={() => {}} disabled />);
  expect(screen.getByRole('button')).toBeDisabled();
});
