/** @jest-environment node */
import { crisisPlan } from '../crisisPlan.ts';
import type { PlanDose, PlanEpisode } from '../crisisPlan.ts';

const DEBRIEFED = '2026-11-21T09:00:00Z';

function episode(id: string, helped: string[], didNotHelp: string[] = [], debriefedAt: string | null = DEBRIEFED): PlanEpisode {
  return { id, helped, didNotHelp, debriefedAt };
}

function dose(id: string, medicationId: string, helped: boolean | null, episodeId: string | null = null): PlanDose {
  return { id, medicationId, episodeId, helped };
}

test('a relief counts the debriefed episodes it helped in, out of those it was tried in', () => {
  const plan = crisisPlan([episode('e1', ['dark_room']), episode('e2', ['dark_room']), episode('e3', [], ['dark_room'])], []);
  expect(plan).toEqual([{ key: 'dark_room', kind: 'relief', helped: 2, of: 3, episodeIds: ['e1', 'e2'] }]);
});

test('an episode that was never debriefed is ignored', () => {
  const plan = crisisPlan([episode('e1', ['sleep']), episode('e2', ['sleep'], [], null), episode('e3', [], ['sleep'], null)], []);
  expect(plan).toEqual([{ key: 'sleep', kind: 'relief', helped: 1, of: 1, episodeIds: ['e1'] }]);
});

test('a medication counts its doses that helped, out of those answered', () => {
  const doses = [dose('d1', 'm1', true, 'e1'), dose('d2', 'm1', true, 'e2'), dose('d3', 'm1', false, 'e3'), dose('d4', 'm1', null, 'e4')];
  expect(crisisPlan([], doses)).toEqual([{ key: 'm1', kind: 'medication', helped: 2, of: 3, episodeIds: ['e1', 'e2'] }]);
});

test('a dose without an episode counts but adds no evidence episode, and an episode is listed once', () => {
  const doses = [dose('d1', 'm1', true, null), dose('d2', 'm1', true, 'e1'), dose('d3', 'm1', true, 'e1')];
  expect(crisisPlan([], doses)).toEqual([{ key: 'm1', kind: 'medication', helped: 3, of: 3, episodeIds: ['e1'] }]);
});

test('an entry that never helped is dropped', () => {
  const plan = crisisPlan([episode('e1', [], ['caffeine'])], [dose('d1', 'm1', false)]);
  expect(plan).toEqual([]);
});

test('entries order by ratio, then by how often they helped, then by key', () => {
  const episodes = [
    // massage: 4 of 5 (0.8)
    episode('e1', ['massage', 'water', 'sleep']),
    episode('e2', ['massage', 'water', 'sleep']),
    episode('e3', ['massage', 'sleep', 'cold_pack']),
    episode('e4', ['massage', 'cold_pack']),
    episode('e5', [], ['massage']),
  ];
  // water: 2 of 2; sleep: 3 of 3; cold_pack: 2 of 2 (ties water on both, so the key decides).
  const keys = crisisPlan(episodes, []).map((entry) => `${entry.key} ${String(entry.helped)}/${String(entry.of)}`);
  expect(keys).toEqual(['sleep 3/3', 'cold_pack 2/2', 'water 2/2', 'massage 4/5']);
});

test('reliefs and medications share one ordering', () => {
  const plan = crisisPlan([episode('e1', ['dark_room']), episode('e2', [], ['dark_room'])], [dose('d1', 'm1', true, 'e1')]);
  expect(plan.map((entry) => entry.key)).toEqual(['m1', 'dark_room']);
});

test('episodeIds holds exactly the episodes behind helped', () => {
  const plan = crisisPlan([episode('e1', ['water']), episode('e2', [], ['water']), episode('e3', ['water'])], []);
  expect(plan[0]?.episodeIds).toEqual(['e1', 'e3']);
});

test('a key in both lists of one attack counts once, as helped', () => {
  const plan = crisisPlan([episode('e1', ['sleep'], ['sleep']), episode('e2', [], ['sleep'])], []);
  expect(plan).toEqual([{ key: 'sleep', kind: 'relief', helped: 1, of: 2, episodeIds: ['e1'] }]);
});

test('a key repeated within helped counts once', () => {
  const plan = crisisPlan([episode('e1', ['water', 'water'])], []);
  expect(plan).toEqual([{ key: 'water', kind: 'relief', helped: 1, of: 1, episodeIds: ['e1'] }]);
});
