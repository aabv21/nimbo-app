import type { Dose } from '../../cabinet/doseStore';
import type { Medication } from '../../cabinet/medicationStore';
import { packs } from '../../condition';
import type { Episode } from '../../episodes/episodeStore';
import { DEBRIEF_FROM_HOUR, DEBRIEF_MAX_AGE_DAYS, debriefChips, debriefDue, debriefGreetingKey } from '../debrief';

const ZONE = 'America/Bogota';
// 07:00 in Bogotá (UTC-5) on 2026-11-27.
const NOW = new Date('2026-11-27T12:00:00Z');
const NONE: ReadonlySet<string> = new Set();
const MED = '00000000-0000-4000-8000-0000000000a1';

function episode(id: string, startedAt: string, endedAt: string | null, patch: Partial<Episode> = {}): Episode {
  return {
    id,
    startedAt,
    endedAt,
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

// 22:00 yesterday in Bogotá is already today in UTC: the day must come from the zone, not from the instant.
const LATE_YESTERDAY = episode('e1', '2026-11-26T22:50:00Z', '2026-11-27T03:00:00Z');

describe('debriefDue', () => {
  test('an attack that ended at 22:00 yesterday is due at 07:00 today', () => {
    expect(debriefDue([LATE_YESTERDAY], NOW, ZONE, NONE)?.id).toBe('e1');
  });

  test(`yesterday’s attack waits for ${String(DEBRIEF_FROM_HOUR)}:00: not due at 04:59, due at 05:00`, () => {
    expect(debriefDue([LATE_YESTERDAY], new Date('2026-11-27T09:59:00Z'), ZONE, NONE)).toBeNull();
    expect(debriefDue([LATE_YESTERDAY], new Date('2026-11-27T10:00:00Z'), ZONE, NONE)?.id).toBe('e1');
  });

  test('just after midnight an older attack is still due, as its morning has passed', () => {
    const twoDays = episode('e8', '2026-11-25T15:00:00Z', '2026-11-25T18:00:00Z');
    expect(debriefDue([LATE_YESTERDAY, twoDays], new Date('2026-11-27T05:30:00Z'), ZONE, NONE)?.id).toBe('e8');
  });

  test('one that ended at 06:00 today is not due yet', () => {
    const early = episode('e2', '2026-11-27T08:00:00Z', '2026-11-27T11:00:00Z');
    expect(debriefDue([early], NOW, ZONE, NONE)).toBeNull();
  });

  test('one still open is not due', () => {
    expect(debriefDue([episode('e3', '2026-11-26T15:00:00Z', null)], NOW, ZONE, NONE)).toBeNull();
  });

  test(`one that ended ${String(DEBRIEF_MAX_AGE_DAYS)} days ago is still due, and 4 days ago is not`, () => {
    const threeDays = episode('e4', '2026-11-24T15:00:00Z', '2026-11-24T18:00:00Z');
    const fourDays = episode('e5', '2026-11-23T15:00:00Z', '2026-11-23T18:00:00Z');
    expect(debriefDue([threeDays], NOW, ZONE, NONE)?.id).toBe('e4');
    expect(debriefDue([fourDays], NOW, ZONE, NONE)).toBeNull();
  });

  test('a debriefed or skipped one is not due', () => {
    const debriefed = { ...LATE_YESTERDAY, debriefedAt: '2026-11-27T11:30:00Z' };
    expect(debriefDue([debriefed], NOW, ZONE, NONE)).toBeNull();
    expect(debriefDue([LATE_YESTERDAY], NOW, ZONE, new Set(['e1']))).toBeNull();
  });

  test('with two candidates the one that ended last wins, in any order', () => {
    const older = episode('e6', '2026-11-25T15:00:00Z', '2026-11-25T18:00:00Z');
    expect(debriefDue([older, LATE_YESTERDAY], NOW, ZONE, NONE)?.id).toBe('e1');
    expect(debriefDue([LATE_YESTERDAY, older], NOW, ZONE, NONE)?.id).toBe('e1');
    // The newer one skipped: the older one is still asked about.
    expect(debriefDue([LATE_YESTERDAY, older], NOW, ZONE, new Set(['e1']))?.id).toBe('e6');
  });
});

describe('debriefChips', () => {
  const withReliefs = episode('e1', '2026-11-26T15:00:00Z', '2026-11-26T19:10:00Z', { reliefs: ['dark_room', 'cold_pack'] });
  const dose = (id: string, medicationId: string, takenAt: string, episodeId: string | null = 'e1'): Dose => ({
    id,
    medicationId,
    episodeId,
    takenAt,
    helped: null,
    dirty: false,
  });
  const medication: Medication = {
    id: MED,
    name: 'Ibuprofen 400 mg',
    kind: 'acute',
    form: 'oral',
    medicationClass: 'simple_analgesic',
    doseText: null,
    minIntervalMinutes: null,
    schedule: null,
    scheduleTime: null,
    scheduleAnchor: null,
    archived: false,
    dirty: false,
  };
  const doses = [dose('d1', MED, '2026-11-26T15:30:00Z'), dose('d2', MED, '2026-11-26T17:30:00Z'), dose('d3', MED, '2026-11-20T10:00:00Z', 'other')];

  test('step 1 lists the attack’s reliefs, then its medications, then the other pack reliefs, each once', () => {
    const chips = debriefChips('helped', withReliefs, doses, [medication], packs.migraine, { helped: [] });
    expect(chips.slice(0, 3).map((chip) => chip.key)).toEqual(['dark_room', 'cold_pack', MED]);
    expect(chips.map((chip) => chip.key)).toHaveLength(packs.migraine.reliefs.length + 1);
    expect(new Set(chips.map((chip) => chip.key)).size).toBe(chips.length);
    expect(chips[0]).toEqual({ key: 'dark_room', kind: 'relief', labelKey: 'condition.reliefs.dark_room', label: null });
  });

  test('a dose chip carries the medication name, once however many doses of it the attack had', () => {
    const chips = debriefChips('helped', withReliefs, doses, [medication], packs.migraine, { helped: [] });
    expect(chips.filter((chip) => chip.kind === 'dose')).toEqual([{ key: MED, kind: 'dose', labelKey: null, label: 'Ibuprofen 400 mg' }]);
  });

  test('step 2 leaves out what step 1 picked', () => {
    const chips = debriefChips('not_helped', withReliefs, doses, [medication], packs.migraine, { helped: ['dark_room', MED] });
    expect(chips.map((chip) => chip.key)).not.toContain('dark_room');
    expect(chips.map((chip) => chip.key)).not.toContain(MED);
    expect(chips.map((chip) => chip.key)).toContain('cold_pack');
  });

  test('step 3 is the pack’s triggers', () => {
    const chips = debriefChips('triggers', withReliefs, doses, [medication], packs.migraine, { helped: [] });
    expect(chips.map((chip) => chip.key)).toEqual(packs.migraine.triggers.map((item) => item.key));
    expect(chips.every((chip) => chip.kind === 'trigger')).toBe(true);
  });
});

describe('debriefGreetingKey', () => {
  test('yesterday’s attack is “yesterday”, one from 2 days ago names its date', () => {
    expect(debriefGreetingKey(LATE_YESTERDAY, NOW, ZONE)).toBe('debrief.q.helped.yesterday');
    const twoDays = episode('e7', '2026-11-25T15:00:00Z', '2026-11-25T18:00:00Z');
    expect(debriefGreetingKey(twoDays, NOW, ZONE)).toBe('debrief.q.helped.date');
  });
});
