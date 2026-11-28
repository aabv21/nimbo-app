import type { Dose } from '../../cabinet/doseStore';
import type { Episode } from '../../episodes/episodeStore';
import { translate } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { EMPTY_FILTER, filterEpisodes } from '../filterEpisodes';
import type { EpisodeFilter } from '../filterEpisodes';

const NOW = new Date('2026-11-26T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function episode(id: string, daysAgo: number, patch: Partial<Episode> = {}): Episode {
  return {
    id,
    startedAt: new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString(),
    endedAt: null,
    intensity: null,
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
    ...patch,
  };
}

function dose(episodeId: string | null): Dose {
  return { id: `dose-${String(episodeId)}`, medicationId: 'med-1', episodeId, takenAt: NOW.toISOString(), helped: null, dirty: false };
}

const en = (key: string): string => translate('en', key as MessageKey);
const es = (key: string): string => translate('es', key as MessageKey);
const ids = (list: readonly Episode[]): string[] => list.map((item) => item.id);
const run = (episodes: readonly Episode[], filter: Partial<EpisodeFilter>, doses: readonly Dose[] = [], label = en): string[] =>
  ids(filterEpisodes(episodes, doses, { ...EMPTY_FILTER, ...filter }, NOW, label));

test('EMPTY_FILTER keeps everything, in the given order', () => {
  const all = [episode('c', 90), episode('a', 1), episode('b', 400)];
  expect(run(all, {})).toEqual(['c', 'a', 'b']);
});

test('minIntensity keeps 7 and 8, drops 6 and an unrated attack', () => {
  const all = [episode('six', 1, { intensity: 6 }), episode('seven', 2, { intensity: 7 }), episode('eight', 3, { intensity: 8 }), episode('none', 4)];
  expect(run(all, { minIntensity: 7 })).toEqual(['seven', 'eight']);
});

test('trigger keeps the attacks that list it', () => {
  const all = [episode('a', 1, { triggers: ['weather', 'stress'] }), episode('b', 2, { triggers: ['stress'] })];
  expect(run(all, { trigger: 'weather' })).toEqual(['a']);
});

test('doses with and without follow the episode link', () => {
  const all = [episode('a', 1), episode('b', 2), episode('c', 3)];
  const doses = [dose('a'), dose(null)];
  expect(run(all, { doses: 'with' }, doses)).toEqual(['a']);
  expect(run(all, { doses: 'without' }, doses)).toEqual(['b', 'c']);
});

test('period is counted back from now', () => {
  const all = [episode('recent', 29), episode('edge', 31), episode('quarter', 80), episode('old', 200)];
  expect(run(all, { period: '30d' })).toEqual(['recent']);
  expect(run(all, { period: '90d' })).toEqual(['recent', 'edge', 'quarter']);
  expect(run(all, { period: 'all' })).toEqual(['recent', 'edge', 'quarter', 'old']);
});

test('the query ignores accents and case, in notes and in the translated labels', () => {
  const all = [
    episode('note', 1, { notes: 'Dolor tras un café muy fuerte' }),
    episode('trigger', 2, { triggers: ['caffeine'] }),
    episode('other', 3, { triggers: ['stress'], notes: 'nada' }),
  ];
  expect(run(all, { query: 'cafe' }, [], es)).toEqual(['note', 'trigger']);
  expect(run(all, { query: 'CAFÉ' }, [], es)).toEqual(['note', 'trigger']);
  // In English the trigger is "Caffeine", which does not contain "cafe".
  expect(run(all, { query: 'cafe' })).toEqual(['note']);
});

test('the query also reaches pain-area and symptom labels', () => {
  const all = [episode('a', 1, { painAreas: ['temple_left'] }), episode('b', 2, { symptoms: ['nausea'] })];
  expect(run(all, { query: 'left temple' })).toEqual(['a']);
  expect(run(all, { query: 'nausea' })).toEqual(['b']);
  expect(run(all, { query: '   ' })).toEqual(['a', 'b']);
});

test('filters combine', () => {
  const all = [
    episode('a', 1, { intensity: 8, triggers: ['weather'] }),
    episode('b', 2, { intensity: 8, triggers: ['stress'] }),
    episode('c', 3, { intensity: 3, triggers: ['weather'] }),
  ];
  expect(run(all, { minIntensity: 7, trigger: 'weather' })).toEqual(['a']);
});

test('a key the pack no longer knows does not break the query', () => {
  expect(run([episode('a', 1, { triggers: ['retired_key'] })], { query: 'x' })).toEqual([]);
});
