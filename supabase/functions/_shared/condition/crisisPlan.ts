// "What helped before": the reliefs and medications that helped in the user's debriefed attacks, best first.
export interface PlanEpisode {
  id: string;
  helped: readonly string[];
  didNotHelp: readonly string[];
  debriefedAt: string | null;
}

export interface PlanDose {
  id: string;
  medicationId: string;
  episodeId: string | null;
  helped: boolean | null;
}

export interface PlanEntry {
  /** A relief key, or the medication's id. */
  key: string;
  kind: 'relief' | 'medication';
  helped: number;
  /** How often it was tried and answered for: `helped` plus the times it did not help. */
  of: number;
  /** The attacks behind `helped`, so a plan row can open them as evidence. */
  episodeIds: readonly string[];
}

interface Tally {
  kind: PlanEntry['kind'];
  helped: number;
  of: number;
  episodeIds: Set<string>;
}

function tallyOf(tallies: Map<string, Tally>, key: string, kind: PlanEntry['kind']): Tally {
  // Relief keys and medication ids never collide: one is a catalog word, the other a uuid.
  let tally = tallies.get(key);
  if (tally === undefined) {
    tally = { kind, helped: 0, of: 0, episodeIds: new Set() };
    tallies.set(key, tally);
  }
  return tally;
}

/** Only an attack the user debriefed counts: an empty `helped` on any other means "not asked", not "nothing helped". */
export function crisisPlan(episodes: readonly PlanEpisode[], doses: readonly PlanDose[]): PlanEntry[] {
  const tallies = new Map<string, Tally>();
  for (const episode of episodes) {
    if (episode.debriefedAt === null) continue;
    const helped = new Set(episode.helped);
    for (const key of helped) {
      const tally = tallyOf(tallies, key, 'relief');
      tally.helped += 1;
      tally.of += 1;
      tally.episodeIds.add(episode.id);
    }
    // An attack counts once per key, even if a key ended up in both lists.
    for (const key of new Set(episode.didNotHelp)) if (!helped.has(key)) tallyOf(tallies, key, 'relief').of += 1;
  }
  for (const dose of doses) {
    if (dose.helped === null) continue;
    const tally = tallyOf(tallies, dose.medicationId, 'medication');
    tally.of += 1;
    if (dose.helped) {
      tally.helped += 1;
      if (dose.episodeId !== null) tally.episodeIds.add(dose.episodeId);
    }
  }

  const entries: PlanEntry[] = [];
  for (const [key, tally] of tallies) {
    if (tally.helped < 1) continue;
    entries.push({ key, kind: tally.kind, helped: tally.helped, of: tally.of, episodeIds: [...tally.episodeIds] });
  }
  // Cross-multiplied so equal ratios compare equal, which a float division would not promise.
  return entries.sort(
    (a, b) => b.helped * a.of - a.helped * b.of || b.helped - a.helped || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
