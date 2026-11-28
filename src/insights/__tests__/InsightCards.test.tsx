import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import History from '../../app/(tabs)/history';
import { translate } from '../../i18n';
import type { MessageKey, Params } from '../../i18n';
import { resetAuth } from '../../test/authMock';
import { seedEpisode } from '../../test/episodeSeed';
import { clearLocalDb } from '../../test/localDbTest';
import { computeInsights, insightNeeds } from '../index';
import type { InsightData, InsightNeed, Records } from '../index';
import { InsightCards } from '../InsightCards';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: jest.fn() }));
jest.mock('../index', () => {
  const actual = jest.requireActual<typeof import('../index')>('../index');
  return { ...actual, computeInsights: jest.fn(actual.computeInsights), insightNeeds: jest.fn(actual.insightNeeds) };
});

interface Case {
  id: string;
  input: Records & { now: string; timeZone: string; trackingSince: string };
  expected: { needs: InsightNeed[] };
}

const { cases } = require('../../../supabase/functions/_shared/__tests__/fixtures/insights-cases.json') as { cases: Case[] };
const t = (key: MessageKey, params?: Params): string => translate('en', key, params);

function dataOf(prefix: string): { data: InsightData; needs: InsightNeed[] } {
  const found = cases.find((item) => item.id.startsWith(prefix));
  if (found === undefined) throw new Error(`no fixture ${prefix}`);
  return { data: { ...found.input, now: new Date(found.input.now) }, needs: found.expected.needs };
}

/** The rendered tree as `toJSON()` gives it: host nodes with children, and the strings inside them. */
type Node = { children?: Node[] | null } | Node[] | string | null;

function textOf(node: Node): string[] {
  if (node === null) return [];
  if (typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(textOf);
  return (node.children ?? []).flatMap(textOf);
}

beforeEach(() => {
  clearLocalDb();
  resetAuth();
  jest.mocked(useLocalSearchParams).mockReturnValue({});
});

test("fixture I01's data renders seven need lines and no digit but their minimums and counts so far", async () => {
  const { data, needs } = dataOf('I01');
  await render(<InsightCards data={data} medicationName={() => null} />);
  expect(screen.queryAllByTestId(/^insight-need-/)).toHaveLength(7);
  expect(screen.queryAllByTestId(/^insight-card-/)).toHaveLength(0);
  expect(screen.getAllByText(t('insight.need.hint'))).toHaveLength(1);
  const allowed = new Set(needs.flatMap((need) => [String(need.min), String(need.have)]));
  const digits = textOf(screen.toJSON()).join(' ').match(/\d+/g) ?? [];
  expect(digits.length).toBeGreaterThan(0);
  for (const number of digits) expect(allowed).toContain(number);
});

test("fixture I05's data renders the afternoon read sentence", async () => {
  const { data } = dataOf('I05');
  await render(<InsightCards data={data} medicationName={() => null} />);
  expect(screen.getByTestId('insight-card-time_of_day')).toBeTruthy();
  expect(screen.getByText('Most started in the afternoon, between 12:00 and 18:00.')).toBeTruthy();
});

test('cards follow the pack order, a kind shown as data or as a need, never both', async () => {
  const { data } = dataOf('I10');
  await render(<InsightCards data={data} medicationName={() => null} />);
  const ids = screen.queryAllByTestId(/^insight-(card|need)-/).map((node) => String(node.props.testID).replace(/^insight-(card|need)-/, ''));
  expect(ids).toEqual([...new Set(ids)]);
  expect(screen.getByTestId('insight-card-sleep_before')).toBeTruthy();
  expect(screen.getAllByText(t('insight.triggers.note')).length).toBeGreaterThan(0);
});

test('the Patterns segment has testID history-view-insights and opens the insights', async () => {
  seedEpisode('user-1', new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() - 2 * 86_400_000 + 3_600_000));
  await render(<History />);
  const tab = screen.getByTestId('history-view-insights');
  expect(tab).toHaveAccessibleName(t('history.view.insights'));
  await fireEvent.press(tab);
  expect(screen.getByRole('tab', { name: t('history.view.insights') })).toBeSelected();
  expect(screen.getByTestId('insight-need-trigger_frequency')).toBeTruthy();
});

test('with no card and no need it says so in one line instead of a bare header', async () => {
  jest.mocked(computeInsights).mockReturnValueOnce([]);
  jest.mocked(insightNeeds).mockReturnValueOnce([]);
  const { data } = dataOf('I01');
  await render(<InsightCards data={data} medicationName={() => null} />);
  expect(screen.getByText(t('insight.empty'))).toBeTruthy();
  expect(screen.queryAllByTestId(/^insight-(card|need)-/)).toHaveLength(0);
  expect(screen.queryByText(t('insight.need.hint'))).toBeNull();
});

test('the stretch figure is hidden from screen readers, as the sentence under it says the number', async () => {
  const { data } = dataOf('I12');
  await render(<InsightCards data={data} medicationName={() => null} />);
  const figure = screen.getByTestId('insight-figure-attack_free_streak', { includeHiddenElements: true });
  expect(figure.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
});

/** The time-of-day card's texts capped at a number of lines. */
function clippedLabels(): unknown[] {
  return within(screen.getByTestId('insight-card-time_of_day'))
    .getAllByText(/./, { includeHiddenElements: true })
    .filter((node) => node.props.numberOfLines !== undefined)
    .map((node) => node.props.children as unknown);
}

function setFontScale(fontScale: number): void {
  Dimensions.set({ window: { ...Dimensions.get('window'), fontScale }, screen: { ...Dimensions.get('screen'), fontScale } });
}

test('at large text sizes the column cards read as rows, so no part-of-day label is cut to two lines', async () => {
  const { data } = dataOf('I05');
  setFontScale(1);
  const regular = await render(<InsightCards data={data} medicationName={() => null} />);
  expect(clippedLabels()).not.toEqual([]);
  await regular.unmount();

  setFontScale(2);
  try {
    await render(<InsightCards data={data} medicationName={() => null} />);
    expect(clippedLabels()).toEqual([]);
    expect(screen.getByText('Most started in the afternoon, between 12:00 and 18:00.')).toBeTruthy();
  } finally {
    setFontScale(1);
  }
});
