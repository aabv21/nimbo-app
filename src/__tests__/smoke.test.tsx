import { render, screen } from '@testing-library/react-native';
import Index from '../app/index';

test('the root route renders the app name', async () => {
  await render(<Index />);
  expect(screen.getByText('Tregua')).toBeOnTheScreen();
});
