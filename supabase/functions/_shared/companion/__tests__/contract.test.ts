/** @jest-environment node */
// The request the app sends and the response it reads: the limits on turns, and the response check the app runs.
import { packs } from '../../condition/index.ts';
import {
  type CompanionResponse,
  isCompanionResponse,
  MAX_TURNS,
  parseCompanionRequest,
  RED_FLAG_KEYS,
  TOTAL_MAX_CHARS,
  TURN_MAX_CHARS,
} from '../contract.ts';

const valid = {
  mode: 'chat',
  locale: 'en',
  localDate: '2026-11-27',
  input: 'text',
  messages: [{ role: 'user', text: 'How were my attacks this month?' }],
};

test('the limits, and the red flags the response may name are the pack\'s', () => {
  expect([MAX_TURNS, TURN_MAX_CHARS, TOTAL_MAX_CHARS]).toEqual([12, 500, 4000]);
  expect(RED_FLAG_KEYS).toEqual(packs.migraine.redFlags.map((flag) => flag.key));
});

describe('parseCompanionRequest', () => {
  test('a valid request comes back trimmed, with an episode id when one is sent', () => {
    expect(parseCompanionRequest(valid)).toEqual(valid);
    const episodeId = '0b8f1e3c-5d4a-4b6e-9c2d-1a2b3c4d5e6f';
    expect(parseCompanionRequest({ ...valid, mode: 'crisis', input: 'voice', episodeId, messages: [{ role: 'user', text: '  ay  ' }] })).toEqual({
      ...valid,
      mode: 'crisis',
      input: 'voice',
      episodeId,
      messages: [{ role: 'user', text: 'ay' }],
    });
  });

  const turns = (count: number) => Array.from({ length: count }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `turn ${String(i)}` }));

  test.each([
    ['a 13th turn', { messages: [...turns(12), { role: 'user', text: 'one more' }] }],
    ['a 501-character turn', { messages: [{ role: 'user', text: 'x'.repeat(501) }] }],
    ['a last turn from the assistant', { messages: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }] }],
    ['a first turn from the assistant', { messages: [{ role: 'assistant', text: 'hello' }, { role: 'user', text: 'hi' }] }],
    ['no turns', { messages: [] }],
    ['an empty turn', { messages: [{ role: 'user', text: '   ' }] }],
    ['more than 4,000 characters in all', { messages: Array.from({ length: 9 }, () => ({ role: 'user', text: 'y'.repeat(450) })) }],
    ["locale 'fr'", { locale: 'fr' }],
    ["mode 'other'", { mode: 'other' }],
    ['input missing', { input: undefined }],
    ["input 'video'", { input: 'video' }],
    ['a localDate that is not YYYY-MM-DD', { localDate: '27/11/2026' }],
    ['a localDate that is not a real day', { localDate: '2026-02-30' }],
    ['a localDate before 2000', { localDate: '1999-12-31' }],
    ['an episode id that is not a uuid', { episodeId: 'e1' }],
    ['a 65-character timeZone', { timeZone: `Zone/${'x'.repeat(60)}` }],
    ['an empty timeZone', { timeZone: '' }],
    ['a timeZone that is not a string', { timeZone: -5 }],
  ])('rejects %s', (_label, change) => {
    expect(parseCompanionRequest({ ...valid, ...change })).toBeNull();
  });

  test('an episode id of null is left out', () => {
    expect(parseCompanionRequest({ ...valid, episodeId: null })).toEqual(valid);
  });

  test('a timeZone of up to 64 characters is kept as given, and a missing or null one left out', () => {
    expect(parseCompanionRequest({ ...valid, timeZone: 'America/Santiago' })).toEqual({ ...valid, timeZone: 'America/Santiago' });
    // Checked against the runtime's zones by the function, not here: an unknown zone is ignored there, not refused.
    expect(parseCompanionRequest({ ...valid, timeZone: 'Mars/Base' })).toEqual({ ...valid, timeZone: 'Mars/Base' });
    expect(parseCompanionRequest({ ...valid, timeZone: `Zone/${'x'.repeat(59)}` })?.timeZone).toHaveLength(64);
    expect(parseCompanionRequest(valid)).toEqual(valid);
    expect(parseCompanionRequest({ ...valid, timeZone: null })).toEqual(valid);
  });

  test('rejects a body that is not an object', () => {
    expect(parseCompanionRequest(null)).toBeNull();
    expect(parseCompanionRequest([valid])).toBeNull();
  });

  test('12 turns of up to 500 characters each are accepted when they stay within 4,000', () => {
    const twelve = turns(11).concat([{ role: 'user', text: 'last' }]);
    expect(parseCompanionRequest({ ...valid, messages: twelve })?.messages).toHaveLength(12);
  });
});

describe('isCompanionResponse', () => {
  const redFlag: CompanionResponse = { reply: null, drafts: [], evidence: [], redFlags: ['thunderclap'], intent: 'other', guard: 'ok', replaced: null };

  test('accepts a red-flag response with reply null', () => {
    expect(isCompanionResponse(redFlag)).toBe(true);
  });

  test('accepts an answer with drafts and evidence, and a replaced reply', () => {
    const answered: CompanionResponse = {
      reply: 'You had 3 attacks this month.',
      drafts: [
        { kind: 'dose', ref: 'd1', medicationId: '0b8f1e3c-5d4a-4b6e-9c2d-1a2b3c4d5e6f', takenAt: '2026-11-27T12:00:00.000Z', episodeId: null },
        {
          kind: 'checkin',
          ref: 'd2',
          localDate: '2026-11-27',
          sleepBand: 'lt5',
          sleepQuality: null,
          stress: 'high',
          lowWater: null,
          extraCaffeine: true,
          alcohol: null,
          skippedMeal: null,
          screenHeavy: null,
        },
        {
          kind: 'episode',
          ref: 'd3',
          episodeId: null,
          startedAt: '2026-11-27T12:00:00.000Z',
          endedAt: null,
          intensity: 6,
          painAreas: [],
          symptoms: ['nausea'],
          triggers: [],
          reliefs: [],
          helped: [],
          didNotHelp: [],
          doses: [],
        },
      ],
      evidence: [
        { ref: 'r1', source: 'episodes', count: 3, of: null, episodeIds: ['a'], doseIds: [] },
        { ref: 'i1', source: 'insight', count: 3, of: 5, episodeIds: ['a'], doseIds: [] },
        { ref: 's1', source: 'signal', count: 10, of: 10, episodeIds: [], doseIds: ['d'] },
      ],
      redFlags: [],
      intent: 'data_question',
      guard: 'degraded',
      replaced: null,
    };
    expect(isCompanionResponse(answered)).toBe(true);
    expect(isCompanionResponse({ ...redFlag, redFlags: [], guard: 'replaced', replaced: 'dose_advice' })).toBe(true);
    expect(isCompanionResponse({ ...redFlag, redFlags: [], guard: 'replaced', replaced: 'refusal' })).toBe(true);
  });

  test.each([
    ['a replaced reply that still carries text', { reply: 'take 400 mg', guard: 'replaced', replaced: 'dose_advice' }],
    ['a replaced guard with no reason', { guard: 'replaced', replaced: null }],
    ['a reason on a reply that was not replaced', { replaced: 'diagnosis' }],
    ['an unknown red flag', { redFlags: ['headache'] }],
    ['an unknown intent', { intent: 'chitchat' }],
    ['an unknown guard', { guard: 'maybe' }],
    ['an unknown draft kind', { drafts: [{ kind: 'note', ref: 'd1' }] }],
    ['an evidence item without a count', { evidence: [{ ref: 'r1', source: 'episodes', of: null, episodeIds: [], doseIds: [] }] }],
    ['a missing field', { drafts: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(isCompanionResponse({ ...redFlag, ...change })).toBe(false);
  });
});
