import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { translate } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { HeadMap } from '../HeadMap';

const t = (key: MessageKey): string => translate('en', key);
const label = (area: string): string => translate('en', `condition.painAreas.${area}` as MessageKey);

const FRONT = ['forehead', 'crown', 'temple_left', 'temple_right', 'eye_left', 'eye_right', 'face'];
const BACK = ['crown', 'back_left', 'back_right', 'neck'];

function regionNames(): string[] {
  return screen.getAllByRole('checkbox').map((node) => String(node.props.accessibilityLabel));
}

test('the front view exposes the seven front regions, each a checkbox with its label, sides named from the user’s view', async () => {
  await render(<HeadMap value={['temple_left']} onChange={jest.fn()} />);

  expect(regionNames().sort()).toEqual(FRONT.map(label).sort());
  expect(screen.getByRole('checkbox', { name: label('temple_left') })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: label('forehead') })).not.toBeChecked();
  expect(screen.getByRole('tab', { name: t('crisis.where.front') })).toBeSelected();
  // Facing the user, their right is on the screen's left.
  const sides = screen.getAllByText(/^Your (left|right)$/).map((node) => node.props.children as string);
  expect(sides).toEqual([t('crisis.where.your_right'), t('crisis.where.your_left')]);
});

test('the back view exposes the four back regions', async () => {
  await render(<HeadMap value={[]} onChange={jest.fn()} />);
  await fireEvent.press(screen.getByRole('tab', { name: t('crisis.where.back') }));

  expect(regionNames().sort()).toEqual(BACK.map(label).sort());
  const sides = screen.getAllByText(/^Your (left|right)$/).map((node) => node.props.children as string);
  expect(sides).toEqual([t('crisis.where.your_left'), t('crisis.where.your_right')]);
});

test('a press toggles the area in painAreas, and the marked list removes one', async () => {
  const onChange = jest.fn();
  function Harness(): React.JSX.Element {
    const [areas, setAreas] = useState<readonly string[]>([]);
    return (
      <HeadMap
        value={areas}
        onChange={(next) => {
          onChange(next);
          setAreas(next);
        }}
      />
    );
  }
  await render(<Harness />);

  await fireEvent.press(screen.getByRole('checkbox', { name: label('temple_left') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: label('eye_left') }));
  expect(onChange).toHaveBeenLastCalledWith(['temple_left', 'eye_left']);
  expect(screen.getByRole('checkbox', { name: label('temple_left') })).toBeChecked();
  expect(screen.getByText(t('crisis.where.marked'))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('checkbox', { name: label('temple_left') }));
  expect(onChange).toHaveBeenLastCalledWith(['eye_left']);

  await fireEvent.press(screen.getByRole('button', { name: label('eye_left') }));
  expect(onChange).toHaveBeenLastCalledWith([]);
  expect(screen.queryByText(t('crisis.where.marked'))).toBeNull();
});

test('every region is at least 48 pt in both directions', async () => {
  await render(<HeadMap value={[]} onChange={jest.fn()} />);
  const check = (): void => {
    for (const node of screen.getAllByRole('checkbox')) {
      const style = StyleSheet.flatten(node.props.style as Parameters<typeof StyleSheet.flatten>[0]) as { width: number; height: number };
      expect(style.width).toBeGreaterThanOrEqual(48);
      expect(style.height).toBeGreaterThanOrEqual(48);
    }
  };
  check();
  await fireEvent.press(screen.getByRole('tab', { name: t('crisis.where.back') }));
  check();
});
