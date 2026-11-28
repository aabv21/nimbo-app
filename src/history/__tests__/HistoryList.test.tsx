import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import type { Episode } from '../../episodes/episodeStore';
import { dayTitle } from '../dateLabels';
import { HistoryList } from '../HistoryList';

jest.mock('../dateLabels', () => {
  const actual = jest.requireActual<typeof import('../dateLabels')>('../dateLabels');
  return { ...actual, dayTitle: jest.fn(actual.dayTitle) };
});

const NOW = new Date(2026, 10, 26, 14, 20);

function episode(id: string, startedAt: Date, endedAt: Date | null): Episode {
  return {
    id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt === null ? null : endedAt.toISOString(),
    intensity: 6,
    painAreas: [],
    symptoms: [],
    triggers: [],
    reliefs: [],
    notes: null,
    source: 'manual',
    helped: [],
    didNotHelp: [],
    debriefedAt: null,
    dirty: false,
  };
}

const OPEN = episode('ep-open', new Date(2026, 10, 26, 9, 0), null);
const ENDED = episode('ep-ended', new Date(2026, 10, 20, 9, 0), new Date(2026, 10, 20, 12, 0));

function list(now: Date, onOpen: (id: string) => void): React.JSX.Element {
  return (
    <HistoryList
      episodes={[OPEN, ENDED]}
      now={now}
      header={<View />}
      empty={<View />}
      query=""
      onQuery={jest.fn()}
      onOpenFilters={jest.fn()}
      onOpen={onOpen}
      bottomPadding={0}
    />
  );
}

/** How many times a row was rendered, read from the day title each render computes. */
function renders(row: Episode): number {
  const started = new Date(row.startedAt).getTime();
  return jest.mocked(dayTitle).mock.calls.filter(([date]) => date.getTime() === started).length;
}

test('a minute tick re-renders only the open attack’s row; an ended row is left alone', async () => {
  const onOpen = jest.fn();
  const view = await render(list(NOW, onOpen));
  expect(screen.getByTestId('episode-row-ep-open')).toBeOnTheScreen();
  const open = renders(OPEN);
  const ended = renders(ENDED);

  await view.rerender(list(new Date(NOW.getTime() + 60_000), onOpen));
  expect(renders(OPEN)).toBe(open + 1);
  expect(renders(ENDED)).toBe(ended);
});
