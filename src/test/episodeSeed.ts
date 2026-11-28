// Attacks for the History and episode suites, made through the store so each one also queues its operations.
import { endEpisode, startEpisode, updateEpisode } from '../episodes/episodeStore';
import type { EpisodePatch } from '../episodes/episodeStore';

/** Starts at `startedAt`, applies `patch`, and ends at `endedAt` (left open when null). */
export function seedEpisode(userId: string, startedAt: Date, endedAt: Date | null, patch: EpisodePatch = {}): string {
  const id = startEpisode(userId, startedAt);
  updateEpisode(userId, id, patch);
  if (endedAt !== null) endEpisode(userId, id, endedAt);
  return id;
}
