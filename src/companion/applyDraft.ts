// The only path from a confirmed draft to records: the stores' transaction-free writers, inside the caller's transaction.
import { logDoseTx } from '../cabinet/doseStore';
import { saveCheckinTx } from '../checkin/checkinStore';
import type { CheckinFields } from '../checkin/checkinStore';
import { logEpisodeTx, readEpisode, saveDebriefTx, updateEpisodeTx } from '../episodes/episodeStore';
import type { Episode, EpisodeInput, EpisodePatch } from '../episodes/episodeStore';
import type { CheckinDraft, Draft, EpisodeDraft } from './contract';

type Ids = { recordId: string; doseIds: readonly string[] };

const union = (...lists: (readonly string[])[]): string[] => [...new Set(lists.flat())];

/** The tag lists the user named, with what is already logged kept: a draft adds to an attack, never erases. */
function tagPatch(draft: EpisodeDraft, episode: Episode | null): Pick<EpisodePatch, 'painAreas' | 'symptoms' | 'triggers' | 'reliefs'> {
  const patch: Pick<EpisodePatch, 'painAreas' | 'symptoms' | 'triggers' | 'reliefs'> = {};
  if (draft.painAreas.length > 0) patch.painAreas = union(episode?.painAreas ?? [], draft.painAreas);
  if (draft.symptoms.length > 0) patch.symptoms = union(episode?.symptoms ?? [], draft.symptoms);
  if (draft.triggers.length > 0) patch.triggers = union(episode?.triggers ?? [], draft.triggers);
  if (draft.reliefs.length > 0) patch.reliefs = union(episode?.reliefs ?? [], draft.reliefs);
  return patch;
}

/** The debrief after this draft: a relief named as helping leaves "did not help", and the other way round. */
function debriefOf(draft: EpisodeDraft, episode: Episode | null): { helped: string[]; didNotHelp: string[] } {
  const helped = union((episode?.helped ?? []).filter((key) => !draft.didNotHelp.includes(key)), draft.helped);
  const didNotHelp = union((episode?.didNotHelp ?? []).filter((key) => !draft.helped.includes(key)), draft.didNotHelp);
  return { helped, didNotHelp };
}

/**
 * The debrief lists, stamped as debriefed only once the attack is over (`ended`, by itself or by this draft): on an
 * attack still open they are kept unstamped, so the day-after debrief is still asked.
 */
function saveHelped(userId: string, episodeId: string, draft: EpisodeDraft, episode: Episode | null, ended: boolean): void {
  if (draft.helped.length === 0 && draft.didNotHelp.length === 0) return;
  const lists = debriefOf(draft, episode);
  if (ended) saveDebriefTx(userId, episodeId, { ...lists, triggers: [], doseHelped: {} });
  else updateEpisodeTx(userId, episodeId, lists);
}

function logDoses(userId: string, draft: EpisodeDraft, episodeId: string, doseIds: readonly string[]): void {
  draft.doses.forEach((dose, index) => {
    const id = doseIds.at(index);
    if (id === undefined) throw new RangeError('A dose has no id.');
    logDoseTx(userId, { id, medicationId: dose.medicationId, takenAt: new Date(dose.takenAt), episodeId });
  });
}

function applyNewEpisode(userId: string, draft: EpisodeDraft, ids: Ids, source: 'chat' | 'voice'): void {
  if (draft.startedAt === null) throw new RangeError('A new attack needs a start.');
  const input: EpisodeInput = { startedAt: draft.startedAt, endedAt: draft.endedAt, source, ...tagPatch(draft, null) };
  if (draft.intensity !== null) input.intensity = draft.intensity;
  logEpisodeTx(userId, ids.recordId, input);
  saveHelped(userId, ids.recordId, draft, null, draft.endedAt !== null);
  logDoses(userId, draft, ids.recordId, ids.doseIds);
}

function applyEpisodeChange(userId: string, episodeId: string, draft: EpisodeDraft, ids: Ids): void {
  const episode = readEpisode(userId, episodeId);
  // Deleted since the draft was made, or never synced to this phone: nothing to attach the change to.
  if (episode === null) throw new RangeError('The attack is not on this phone.');
  const patch: EpisodePatch = tagPatch(draft, episode);
  if (draft.startedAt !== null) patch.startedAt = draft.startedAt;
  // In the same patch as the start, so the pair is checked together: a start moved past the old end with a new end is valid.
  if (draft.endedAt !== null) patch.endedAt = draft.endedAt;
  if (draft.intensity !== null) patch.intensity = draft.intensity;
  updateEpisodeTx(userId, episodeId, patch);
  saveHelped(userId, episodeId, draft, episode, episode.endedAt !== null || draft.endedAt !== null);
  logDoses(userId, draft, episodeId, ids.doseIds);
}

/** Only what the user said: a null answer is left out, so it never overwrites the day's saved one. */
function checkinFields(draft: CheckinDraft): CheckinFields {
  const fields: CheckinFields = {};
  if (draft.sleepBand !== null) fields.sleepBand = draft.sleepBand;
  if (draft.sleepQuality !== null) fields.sleepQuality = draft.sleepQuality;
  if (draft.stress !== null) fields.stress = draft.stress;
  if (draft.lowWater !== null) fields.lowWater = draft.lowWater;
  if (draft.extraCaffeine !== null) fields.extraCaffeine = draft.extraCaffeine;
  if (draft.alcohol !== null) fields.alcohol = draft.alcohol;
  if (draft.skippedMeal !== null) fields.skippedMeal = draft.skippedMeal;
  if (draft.screenHeavy !== null) fields.screenHeavy = draft.screenHeavy;
  return fields;
}

/**
 * Writes the draft's records with the ids made on its first Confirm. Assumes an open transaction; a store's
 * `RangeError` (or one of the checks here) propagates so the caller rolls everything back.
 */
export function applyDraft(userId: string, draft: Draft, ids: Ids, source: 'chat' | 'voice'): void {
  switch (draft.kind) {
    case 'episode':
      if (draft.episodeId === null) applyNewEpisode(userId, draft, ids, source);
      else applyEpisodeChange(userId, draft.episodeId, draft, ids);
      return;
    case 'dose':
      // Deleted since the draft was made: the server would refuse the dose for good, so it is refused here instead.
      if (draft.episodeId !== null && readEpisode(userId, draft.episodeId) === null) throw new RangeError('The attack is not on this phone.');
      logDoseTx(userId, { id: ids.recordId, medicationId: draft.medicationId, takenAt: new Date(draft.takenAt), episodeId: draft.episodeId });
      return;
    case 'checkin':
      saveCheckinTx(userId, draft.localDate, checkinFields(draft));
      return;
  }
}
