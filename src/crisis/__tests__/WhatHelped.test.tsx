import { fireEvent, render, screen } from '@testing-library/react-native';

import { logDose } from '../../cabinet/doseStore';
import { saveMedication } from '../../cabinet/medicationStore';
import type { MedicationInput } from '../../cabinet/medicationStore';
import { endEpisode, readEpisode, saveDebrief, startEpisode, updateEpisode } from '../../episodes/episodeStore';
import * as episodeStore from '../../episodes/episodeStore';
import { translate } from '../../i18n';
import type { MessageKey, Params } from '../../i18n';
import { localDb } from '../../lib/local/db';
import { READY_PROFILE, resetAuth } from '../../test/authMock';
import { clearLocalDb } from '../../test/localDbTest';
import { WhatHelped } from '../WhatHelped';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const USER = 'user-1';
const NOW = new Date('2026-11-27T18:00:00Z');
const SUMATRIPTAN = '00000000-0000-4000-8000-0000000000a2';
const TRIPTAN: MedicationInput = {
  name: 'Sumatriptan 50 mg',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'triptan',
  doseText: null,
  minIntervalHours: 2,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
};

/** An attack on day `day` of November, ended, with the debrief answers given. */
function debriefed(day: number, helped: string[], didNotHelp: string[] = [], doseHelped?: boolean): string {
  const id = startEpisode(USER, new Date(2026, 10, day, 9));
  const doseIds = new Map<string, boolean>();
  if (doseHelped !== undefined) {
    doseIds.set(logDose(USER, { medicationId: SUMATRIPTAN, takenAt: new Date(2026, 10, day, 9, 30), episodeId: id }), doseHelped);
  }
  endEpisode(USER, id, new Date(2026, 10, day, 12));
  saveDebrief(USER, id, { helped, didNotHelp, triggers: [], doseHelped: Object.fromEntries(doseIds) });
  return id;
}

let openId = '';

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  saveMedication(USER, SUMATRIPTAN, TRIPTAN);
});

afterEach(() => {
  jest.useRealTimers();
});

function openAttack(): string {
  openId = startEpisode(USER, new Date(NOW.getTime() - 30 * 60 * 1000));
  return openId;
}

test('with two debriefed attacks where a dark room helped, the row reads "Helped 2 of 2 times"', async () => {
  debriefed(20, ['dark_room']);
  debriefed(22, ['dark_room', 'cold_pack'], []);
  debriefed(24, [], ['cold_pack']);
  await render(<WhatHelped episodeId={openAttack()} />);

  expect(screen.getByRole('header', { name: t('crisis.helped.title') })).toBeOnTheScreen();
  expect(screen.getByText(t('condition.reliefs.dark_room'))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.helped.row', { n: 2, of: 2 }))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.helped.row', { n: 1, of: 2 }))).toBeOnTheScreen();
  expect(screen.getByText(t('crisis.helped.from'))).toBeOnTheScreen();
});

test('"Doing it now" on it calls updateEpisode with the reliefs including dark_room, and a second tap takes it back', async () => {
  debriefed(20, ['dark_room']);
  debriefed(22, ['dark_room']);
  const id = openAttack();
  updateEpisode(USER, id, { reliefs: ['water'] });
  const spy = jest.spyOn(episodeStore, 'updateEpisode');
  await render(<WhatHelped episodeId={id} />);

  const doing = screen.getByRole('checkbox', { name: `${t('crisis.helped.doing')}, ${t('condition.reliefs.dark_room')}` });
  expect(doing).not.toBeChecked();
  await fireEvent.press(doing);
  expect(spy).toHaveBeenCalledWith(USER, id, { reliefs: expect.arrayContaining(['dark_room', 'water']) as unknown });
  expect(readEpisode(USER, id)?.reliefs).toEqual(['water', 'dark_room']);
  expect(screen.getByRole('checkbox', { name: `${t('crisis.helped.doing')}, ${t('condition.reliefs.dark_room')}` })).toBeChecked();

  await fireEvent.press(screen.getByRole('checkbox', { name: `${t('crisis.helped.doing')}, ${t('condition.reliefs.dark_room')}` }));
  expect(readEpisode(USER, id)?.reliefs).toEqual(['water']);
});

test("a medication row's action is that medication's dose button, logging on this attack", async () => {
  debriefed(20, [], [], true);
  debriefed(22, [], [], false);
  const id = openAttack();
  await render(<WhatHelped episodeId={id} />);

  expect(screen.getByText(t('crisis.helped.row', { n: 1, of: 2 }))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: `${t('crisis.dose.log')}, ${TRIPTAN.name}` }));
  expect(localDb().getAllSync('SELECT episode_id FROM doses WHERE episode_id = ?;', [id])).toEqual([{ episode_id: id }]);
  // Its own ids, so a flow never confuses it with the Doses section's button.
  expect(screen.getByTestId('dose-helped-log')).toBeOnTheScreen();
  expect(screen.getByTestId('dose-helped-change')).toBeOnTheScreen();
  expect(screen.queryByTestId('dose-log')).toBeNull();
});

test('only the top three entries show', async () => {
  debriefed(20, ['dark_room', 'cold_pack', 'water', 'sleep']);
  await render(<WhatHelped episodeId={openAttack()} />);
  expect(screen.getAllByText(t('crisis.helped.row', { n: 1, of: 1 }))).toHaveLength(3);
});

test('an archived medication is left out of the plan', async () => {
  debriefed(20, [], [], true);
  saveMedication(USER, SUMATRIPTAN, { ...TRIPTAN, archived: true });
  await render(<WhatHelped episodeId={openAttack()} />);
  expect(screen.queryByText(t('crisis.helped.title'))).toBeNull();
});

test('with no debriefs nothing renders', async () => {
  const id = startEpisode(USER, new Date(2026, 10, 20, 9));
  updateEpisode(USER, id, { helped: ['dark_room'] });
  endEpisode(USER, id, new Date(2026, 10, 20, 12));
  await render(<WhatHelped episodeId={openAttack()} />);
  expect(screen.queryByText(t('crisis.helped.title'))).toBeNull();
  expect(screen.toJSON()).toBeNull();
});

test('it renders with the AI off: it is code over local data', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  debriefed(20, ['dark_room']);
  await render(<WhatHelped episodeId={openAttack()} />);
  expect(screen.getByText(t('crisis.helped.title'))).toBeOnTheScreen();
});
