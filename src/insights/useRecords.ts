// The local mirror as the records the insights read, cut to the window `record_inputs` gives the server.
import { useMemo } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { useDoses } from '../cabinet/doseStore';
import { useMedications } from '../cabinet/medicationStore';
import { useCheckins } from '../checkin/checkinStore';
import { useEpisodes } from '../episodes/episodeStore';
import { deviceTimeZone, localDate } from '../lib/localDate';
import { INSIGHT_SINCE_DAYS } from './index';
import type { RecordInputs } from './index';

const DAY_MS = 86_400_000;
const LAST_DATE = '9999-12-31';

/** The device zone when the runtime can use it, else UTC: the insights' date maths throws on an unknown zone. */
export function usableZone(timeZone: string | undefined): string {
  if (timeZone === undefined || timeZone === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** The user's records on this phone; `hasLocation` is false because the phone never reads its saved area back. */
export function useRecords(userId: string): RecordInputs {
  const { profile } = useAuth();
  const today = localDate();
  // As the server's `p_since`: a day of slack on each side keeps the same records whatever the zone.
  const since = Date.parse(`${today}T00:00:00Z`) - (INSIGHT_SINCE_DAYS + 1) * DAY_MS;
  const fromDate = new Date(since - DAY_MS).toISOString().slice(0, 10);
  const episodes = useEpisodes(userId);
  const doses = useDoses(userId);
  const medications = useMedications(userId, { includeArchived: true });
  const checkins = useCheckins(userId, fromDate, LAST_DATE);
  // Read on every render (History re-renders each minute), so Patterns follows a trip to another zone.
  const timeZone = usableZone(deviceTimeZone());
  const knownTriggers = profile?.knownTriggers;
  const onboardedAt = profile?.onboardingCompletedAt ?? null;

  return useMemo(
    () => ({
      timeZone,
      knownTriggers: knownTriggers ?? [],
      onboardedAt,
      hasLocation: false,
      episodes: episodes
        .filter((episode) => episode.endedAt === null || Date.parse(episode.startedAt) >= since)
        .map((episode) => ({
          id: episode.id,
          startedAt: episode.startedAt,
          endedAt: episode.endedAt,
          intensity: episode.intensity,
          triggers: episode.triggers,
          helped: episode.helped,
          didNotHelp: episode.didNotHelp,
          debriefedAt: episode.debriefedAt,
        })),
      checkins: checkins.map((checkin) => ({ localDate: checkin.localDate, sleepBand: checkin.sleepBand, stress: checkin.stress })),
      doses: doses
        .filter((dose) => Date.parse(dose.takenAt) >= since)
        .map((dose) => ({ id: dose.id, medicationId: dose.medicationId, episodeId: dose.episodeId, takenAt: dose.takenAt, helped: dose.helped })),
      medications: medications.map((medication) => ({ id: medication.id, name: medication.name, kind: medication.kind, class: medication.medicationClass })),
    }),
    [timeZone, episodes, doses, medications, checkins, knownTriggers, onboardedAt, since],
  );
}
