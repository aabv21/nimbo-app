// The History filters and the search, as pure functions over what is already on the phone.
import type { Dose } from '../cabinet/doseStore';
import { normalizeText, packs } from '../condition';
import type { CatalogName } from '../condition';
import type { Episode } from '../episodes/episodeStore';

export interface EpisodeFilter {
  query: string;
  minIntensity: number | null;
  trigger: string | null;
  doses: 'any' | 'with' | 'without';
  period: '30d' | '90d' | 'all';
}

export const EMPTY_FILTER: EpisodeFilter = { query: '', minIntensity: null, trigger: null, doses: 'any', period: 'all' };

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = { '30d': 30, '90d': 90 } as const;
const SEARCHED: readonly { catalog: CatalogName; field: 'painAreas' | 'symptoms' | 'triggers' }[] = [
  { catalog: 'painAreas', field: 'painAreas' },
  { catalog: 'symptoms', field: 'symptoms' },
  { catalog: 'triggers', field: 'triggers' },
];

/** What the query is matched against: the notes and the labels the user reads, so "cafe" finds "Cafeína". */
function haystack(episode: Episode, label: (labelKey: string) => string): string {
  const labels = SEARCHED.flatMap(({ catalog, field }) =>
    episode[field].flatMap((key) => {
      const item = packs.migraine[catalog].find((candidate) => candidate.key === key);
      // A key from a newer pack has no label here; it is just not searchable.
      return item === undefined ? [] : [label(item.labelKey)];
    }),
  );
  return normalizeText([episode.notes ?? '', ...labels].join(' '));
}

/** The episodes that pass every filter, in the order given. */
export function filterEpisodes(
  episodes: readonly Episode[],
  doses: readonly Dose[],
  filter: EpisodeFilter,
  now: Date,
  label: (labelKey: string) => string,
): Episode[] {
  const query = normalizeText(filter.query);
  const withDose = new Set(doses.flatMap((dose) => (dose.episodeId === null ? [] : [dose.episodeId])));
  const since = filter.period === 'all' ? null : now.getTime() - PERIOD_DAYS[filter.period] * DAY_MS;
  const { minIntensity, trigger } = filter;

  return episodes.filter((episode) => {
    if (minIntensity !== null && (episode.intensity === null || episode.intensity < minIntensity)) return false;
    if (trigger !== null && !episode.triggers.includes(trigger)) return false;
    if (filter.doses !== 'any' && withDose.has(episode.id) !== (filter.doses === 'with')) return false;
    if (since !== null && new Date(episode.startedAt).getTime() < since) return false;
    return query === '' || haystack(episode, label).includes(query);
  });
}
