import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { translate } from '../../i18n';
import type { MessageKey, Params, PluralKey } from '../../i18n';
import { translatePlural } from '../../i18n/plural';
import type { Signal } from '../index';
import { SignalRow, WEATHER_ATTRIBUTION_URL } from '../SignalRow';
import { signalText } from '../signalText';

const openURL = jest.spyOn(Linking, 'openURL');
const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const tp = (key: PluralKey, count: number, params?: Params): string => translatePlural('en', key, count, params);
const ctx = { t, tp, locale: 'en' as const, knownTriggers: ['weather'], timeZone: 'America/Bogota' };

const PRESSURE: Signal = {
  kind: 'pressure',
  cause: 'pressure',
  causeKey: 'pressure:2026-11-27',
  evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
};
const DEBRIEF: Signal = { kind: 'debrief_due', cause: 'debrief:e1', causeKey: 'debrief:e1', evidence: { episodeId: 'e1', endedAt: '2026-11-26T23:40:00Z' } };

beforeEach(() => {
  openURL.mockReset();
  openURL.mockResolvedValue(undefined);
});

test('the row reads its title and reason, and a tap opens it onto the detail and source', async () => {
  const text = signalText(DEBRIEF, ctx);
  await render(<SignalRow signal={DEBRIEF} text={text} onAction={jest.fn()} />);
  const row = screen.getByRole('button', { name: `${text.title}. ${text.reason}` });
  expect(row.props.accessibilityState).toMatchObject({ expanded: false });
  expect(screen.queryByText(text.detail)).not.toBeOnTheScreen();

  await fireEvent.press(row);
  expect(screen.getByRole('button', { name: `${text.title}. ${text.reason}` }).props.accessibilityState).toMatchObject({ expanded: true });
  expect(screen.getByText(text.detail)).toBeOnTheScreen();
  expect(screen.getByText(text.source)).toBeOnTheScreen();
});

test('the action button reports its kind', async () => {
  const onAction = jest.fn();
  const text = signalText(DEBRIEF, ctx);
  await render(<SignalRow signal={DEBRIEF} text={text} onAction={onAction} />);
  await fireEvent.press(screen.getByRole('button', { name: `${text.title}. ${text.reason}` }));
  await fireEvent.press(screen.getByRole('button', { name: t('signal.debrief.action') }));
  expect(onAction).toHaveBeenCalledWith('debrief');
});

test('the pressure row credits the weather provider with a link to it', async () => {
  const text = signalText(PRESSURE, ctx);
  await render(<SignalRow signal={PRESSURE} text={text} onAction={jest.fn()} />);
  await fireEvent.press(screen.getByRole('button', { name: `${text.title}. ${text.reason}` }));

  const link = screen.getByRole('link', { name: 'Weather data by Open-Meteo.com' });
  await fireEvent.press(link);
  expect(openURL).toHaveBeenCalledWith('https://open-meteo.com/');
  expect(WEATHER_ATTRIBUTION_URL).toBe('https://open-meteo.com/');
});
