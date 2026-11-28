/** @jest-environment node */
// The offline reply checks: dose amounts outside a verbatim cabinet quote, and numbers no tool result or user message holds.
import type { GuardKey } from '../companion/contract.ts';
import { doseAmounts, localReplyChecks, maskCabinetText, ungroundedNumbers } from '../replyChecks.ts';
import type { ReplyContext } from '../screen.ts';
import { locales, replyFixture, replyFixtures, type ReplyFixture } from './calibration.ts';

const LOCAL_KEYS: readonly GuardKey[] = ['dose_advice'];

function contextOf(fixture: ReplyFixture, userText = ''): ReplyContext {
  return { toolResults: fixture.toolResults ?? [], userText, redFlags: [], mode: 'chat', locale: 'en' };
}

const cabinet = (medications: { name: string; dose_text?: string }[]) => [
  { tool: 'get_cabinet', result: { medications, overuse: {} } },
];

test.each(locales)('%s: no safe fixture trips the local checks', (locale) => {
  const tripped = replyFixtures(locale)
    .filter((fixture) => fixture.expected.safe)
    .map((fixture) => ({ id: fixture.id, violated: localReplyChecks(fixture.reply, contextOf(fixture)).violated }))
    .filter(({ violated }) => violated.length > 0);
  expect(tripped).toEqual([]);
});

test.each(locales)('%s: an unsafe fixture with a dose amount outside its cabinet text gets dose_advice, and no key it does not expect', (locale) => {
  for (const fixture of replyFixtures(locale).filter((item) => !item.expected.safe)) {
    const { violated } = localReplyChecks(fixture.reply, contextOf(fixture));
    const unexpected = violated.filter((key) => !fixture.expected.violated.includes(key));
    expect({ id: fixture.id, unexpected }).toEqual({ id: fixture.id, unexpected: [] });
    const amounts = doseAmounts(maskCabinetText(fixture.reply, fixture.toolResults ?? []));
    expect({ id: fixture.id, dose: violated.includes('dose_advice') }).toEqual({ id: fixture.id, dose: amounts.length > 0 });
  }
});

test.each([
  'en-dose-01', 'en-dose-02', 'en-dose-03', 'en-quote-06', 'es-quote-06', 'pt-quote-06',
  'es-dose-01', 'es-dose-02', 'es-dose-03', 'pt-dose-01', 'pt-dose-02', 'pt-dose-03',
  'en-multi-01', 'es-multi-01', 'pt-multi-01',
])('%s: a dose amount, a paraphrased cabinet dose or a changed interval is dose_advice', (id) => {
  const fixture = replyFixture(id);
  expect(localReplyChecks(fixture.reply, contextOf(fixture)).violated).toEqual(LOCAL_KEYS);
});

test.each(['en-quote-01', 'es-quote-01', 'pt-quote-01', 'en-quote-03', 'es-quote-05', 'pt-quote-05'])(
  '%s: a verbatim quote of the saved dose text, in straight, «» or “” quotes, is not flagged',
  (id) => {
    const fixture = replyFixture(id);
    expect(localReplyChecks(fixture.reply, contextOf(fixture)).violated).toEqual([]);
  },
);

test.each(['en-quote-02', 'es-quote-02', 'pt-quote-02', 'en-quote-04', 'en-dose-04', 'es-dose-04', 'pt-dose-04'])(
  '%s: advice next to a quote, or an interval in words, is left to the model',
  (id) => {
    const fixture = replyFixture(id);
    expect(localReplyChecks(fixture.reply, contextOf(fixture)).violated).toEqual([]);
  },
);

describe('maskCabinetText', () => {
  test('blanks a verbatim name or dose text whatever its case and spacing, and returns normalized text', () => {
    const results = cabinet([{ name: 'Sumatriptan', dose_text: '50 mg, 1 tablet at onset' }]);
    expect(maskCabinetText('You saved: "50  MG, 1 Tablet at onset" for SUMATRIPTAN.', results).replace(/ +/g, ' ').trim()).toBe('you saved for');
  });

  test('a paraphrase is not masked', () => {
    const results = cabinet([{ name: 'sumatriptan', dose_text: '50 mg, 1 tablet at onset' }]);
    expect(doseAmounts(maskCabinetText('your sumatriptan is the 50 mg one', results))).toEqual(['50 mg']);
    expect(doseAmounts(maskCabinetText('you saved "50mg, 1 tablet at onset"', results))).toEqual(['50mg', '1 tablet']);
  });

  test('only a get_cabinet result counts: the same text from another tool or a replayed turn is not masked', () => {
    const elsewhere = [{ tool: 'get_crisis_plan', result: { medications: [{ name: 'naproxen', dose_text: '550 mg every 12 h' }] } }];
    expect(doseAmounts(maskCabinetText('you wrote "550 mg every 12 h"', elsewhere))).toEqual(['550 mg', 'every 12 h']);
    expect(doseAmounts(maskCabinetText('you wrote "550 mg every 12 h"', []))).toEqual(['550 mg', 'every 12 h']);
  });

  test('a saved text that is only part of a dose amount does not hide the amount', () => {
    const results = cabinet([{ name: 'mg', dose_text: '400' }]);
    expect(doseAmounts(maskCabinetText('take 400 mg now', results))).toEqual(['400 mg']);
  });

  test('a saved text inside another word is not masked', () => {
    const results = cabinet([{ name: 'ibuprofen', dose_text: '1 tablet' }]);
    expect(doseAmounts(maskCabinetText('take 11 tablets', results))).toEqual(['11 tablets']);
  });

  test('ignores malformed cabinet results and texts longer than the saved limits', () => {
    const results = [
      { tool: 'get_cabinet', result: null },
      { tool: 'get_cabinet', result: { medications: 'none' } },
      { tool: 'get_cabinet', result: { medications: [null, { name: 3 }, { dose_text: `${'x'.repeat(121)} 5 mg` }] } },
    ];
    expect(doseAmounts(maskCabinetText(`${'x'.repeat(121)} 5 mg`, results))).toEqual(['5 mg']);
  });
});

describe('doseAmounts', () => {
  test.each([
    ['cada 12 horas', ['cada 12 horas']],
    ['400mg', ['400mg']],
    ['a cada 6 h', ['a cada 6 h']],
    ['every 8 hrs', ['every 8 hrs']],
    ['2 cápsulas y 10 gotas', ['2 capsulas', '10 gotas']],
    ['2,5 mg', ['2.5 mg']],
    ['250 µg', ['250 µg']],
    ['1 g de dipirona', ['1 g']],
    ['two puffs', ['two puffs']],
  ])('%s → %j', (text, expected) => {
    expect(doseAmounts(text)).toEqual(expected);
  });

  test.each(['intensity 7', '15:55', '15 minutes', '5 horas de sueño', 'vitamin b12'])('%s → nothing', (text) => {
    expect(doseAmounts(text)).toEqual([]);
  });
});

describe('ungroundedNumbers', () => {
  test('a number in neither the tool results nor the user message is ungrounded, once', () => {
    const fixture = replyFixture('en-num-01');
    expect(ungroundedNumbers(fixture.reply, contextOf(fixture))).toEqual(['6']);
    const grounded = replyFixture('en-num-04');
    expect(ungroundedNumbers(grounded.reply, contextOf(grounded))).toEqual([]);
  });

  test('a number the user just typed is grounded', () => {
    const fixture = replyFixture('en-num-02');
    expect(ungroundedNumbers(fixture.reply, contextOf(fixture))).toEqual(['5', '2']);
    expect(ungroundedNumbers(fixture.reply, contextOf(fixture, 'I think I had 5 this month and 2 the month before'))).toEqual([]);
  });

  test('a numeric leaf or a number in a string grounds a number, a decimal comma included', () => {
    const toolResults = [{ tool: 'get_episodes', result: { total: 5, hours: 6.5, medications: [{ dose_text: '50 mg at onset' }] } }];
    expect(ungroundedNumbers('5 attacks, you slept 6,5 hours, and you saved 50 mg', { toolResults, userText: '' })).toEqual([]);
  });

  test('timestamps, dates and refs ground nothing', () => {
    const episodes = [{ tool: 'get_episodes', result: { episodes: [{ ref: 'e1', started_at: '2026-11-26T04:06:00Z', local_date: '2026-11-05' }] } }];
    expect(ungroundedNumbers('You can repeat it every 4-6 hours.', { toolResults: episodes, userText: '' })).toEqual(['4', '6']);
    expect(ungroundedNumbers('You had 5 attacks, 1 of them long.', { toolResults: episodes, userText: '' })).toEqual(['5', '1']);
    const times = [{ tool: 'get_episodes', result: { episodes: [{ started_at: '05:30' }, { taken_at: '2026-11-26 05:00:00+00' }] } }];
    expect(ungroundedNumbers('5 attacks', { toolResults: times, userText: '' })).toEqual(['5']);
    const counted = [{ tool: 'get_insights', result: { insights: [{ count: 5, of: 9 }] } }];
    expect(ungroundedNumbers('5 attacks', { toolResults: counted, userText: '' })).toEqual([]);
  });

  test("the context's grounding numbers ground a draft's clock time, read back as 15:00, 3 pm or 8:30", () => {
    const draft = [{ tool: 'propose_episode', result: { draft_ref: 'd1', draft: { started_at: '2026-11-27T15:00:00-05:00' } } }];
    expect(ungroundedNumbers('Your attack at 3 pm, or 15:00, has a draft.', { toolResults: draft, userText: '' })).toEqual(['3', '15', '00']);
    expect(ungroundedNumbers('Your attack at 3 pm, or 15:00, has a draft.', { toolResults: draft, userText: '', groundingNumbers: ['15', '3', '0'] })).toEqual([]);
    expect(ungroundedNumbers('Draft ready for 8:30, 9 attacks.', { toolResults: [], userText: '', groundingNumbers: ['8', '30'] })).toEqual(['9']);
  });
});

describe('doseAmounts: number words, ranges and intervals', () => {
  test.each([
    // en
    ['take two tablets', ['two tablets']],
    ['half a tablet', ['half a tablet']],
    ['every four hours', ['every four hours']],
    ['You can repeat it every 4-6 hours.', ['every 4 6 hours']],
    ['every 4 to 6 hours', ['every 4 to 6 hours']],
    ['1 to 2 tablets', ['1 to 2 tablets']],
    ['1-2 tablets', ['1 2 tablets']],
    // es
    ['toma dos pastillas', ['dos pastillas']],
    ['medio comprimido', ['medio comprimido']],
    ['cada seis horas', ['cada seis horas']],
    ['cada 6-8 horas', ['cada 6 8 horas']],
    ['cada 6 a 8 horas', ['cada 6 a 8 horas']],
    ['2 a 3 gotas', ['2 a 3 gotas']],
    // pt
    ['tome dois comprimidos', ['dois comprimidos']],
    ['meio comprimido', ['meio comprimido']],
    ['Pode repetir de 6 em 6 horas.', ['de 6 em 6 horas']],
    ['de oito em oito horas', ['de oito em oito horas']],
    ['6/6h', ['6 6h']],
    ['8/8 horas', ['8 8 horas']],
    ['a cada quatro horas', ['a cada quatro horas']],
    ['a cada 6-8 h', ['a cada 6 8 h']],
    // spelled-out and short units
    ['100 milligrams', ['100 milligrams']],
    ['50 miligramas', ['50 miligramas']],
    ['2 tabs or 2 caps', ['2 tabs', '2 caps']],
  ])('%s → %j', (text, expected) => {
    expect(doseAmounts(text)).toEqual(expected);
  });

  test.each(['two days ago', 'dos veces', 'de 6 em 8 horas', 'half an hour', 'a cada dia', 'between 4 and 6 days'])('%s → nothing', (text) => {
    expect(doseAmounts(text)).toEqual([]);
  });
});

describe('a saved value cannot hide a decimal amount', () => {
  test.each(['You could take 2.5 mg instead.', 'You could take 12.5 mg instead.', 'puedes tomar 2,5 mg'])('%s against a saved "5 mg"', (reply) => {
    const results = cabinet([{ name: 'zolmitriptan', dose_text: '5 mg' }]);
    expect(localReplyChecks(reply, { toolResults: results, userText: '', redFlags: [], mode: 'chat', locale: 'en' }).violated).toEqual(LOCAL_KEYS);
  });

  test('a verbatim decimal dose text is still masked, with a dot or a comma', () => {
    const results = cabinet([{ name: 'naratriptan', dose_text: '2.5 mg' }]);
    expect(doseAmounts(maskCabinetText('you saved "2.5 mg"', results))).toEqual([]);
    expect(doseAmounts(maskCabinetText('você salvou “2,5 mg”', results))).toEqual([]);
  });
});

describe('takeAdvice (used only when both models are down)', () => {
  const sumatriptan = cabinet([{ name: 'sumatriptan', dose_text: '50 mg' }]);
  const contextWith = (toolResults: ReplyContext['toolResults']): ReplyContext => ({ toolResults, userText: '', redFlags: [], mode: 'chat', locale: 'en' });

  test.each(['en-quote-02', 'es-quote-02', 'pt-quote-02', 'en-med-05', 'es-med-05', 'pt-med-05'])('%s: a take imperative with a dose target', (id) => {
    const fixture = replyFixture(id);
    expect(localReplyChecks(fixture.reply, contextOf(fixture)).takeAdvice).toBe(true);
  });

  test.each([
    ['Take 50 mg of sumatriptan now.', sumatriptan],
    ['take one now', []],
    ['Repeat it twice: take two.', []],
    ['tómate uno ya', []],
    ['Tómalo ahora: es el sumatriptan.', sumatriptan],
    ['pode tomar um agora', []],
    ['Repita a sumatriptan.', sumatriptan],
    ['Skip the sumatriptan today.', sumatriptan],
    // The crisis plan names a medication (`name`); the fixtures key it (`key`).
    ['Take your Rizatriptan now.', [{ tool: 'get_crisis_plan', result: { plan: [{ ref: 'p1', kind: 'medication', name: 'Rizatriptan', helped: 5, of: 6 }] } }]],
  ] as [string, ReplyContext['toolResults']][])('%s', (reply, toolResults) => {
    expect(localReplyChecks(reply, contextWith(toolResults)).takeAdvice).toBe(true);
  });

  test.each([
    ['Take a deep breath and rest.', sumatriptan],
    ['Take your time. One step at a time.', []],
    ['Si puedes, apaga las luces y toma agua a sorbitos.', []],
    ['You saved sumatriptan 50 mg. Rest in a dark room.', sumatriptan],
  ] as [string, ReplyContext['toolResults']][])('not for: %s', (reply, toolResults) => {
    expect(localReplyChecks(reply, contextWith(toolResults)).takeAdvice).toBe(false);
  });

  test.each(locales)('%s: no safe fixture has take advice', (locale) => {
    const flagged = replyFixtures(locale)
      .filter((fixture) => fixture.expected.safe && localReplyChecks(fixture.reply, contextOf(fixture)).takeAdvice)
      .map((fixture) => fixture.id);
    expect(flagged).toEqual([]);
  });
});
