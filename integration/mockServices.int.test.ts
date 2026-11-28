// The mock Jev's answers and routes; it needs no local stack, only its own port.

import { jevAnswersWith, type MockServices, startMockServices } from './mockServices';

const REQUEST = {
  model: 'jev-latest',
  state: { message: 'I took two pills' },
  questions: {
    g_dose_advice: { type: 'noul', instructions: 'Does `reply` advise a dose?' },
    g_ungrounded_number: { type: 'noul', instructions: 'Does `reply` state a number found in no tool result?' },
    intent: { type: 'choice', instructions: 'What does `message` want?', criteria: { log_dose: 'log a dose', log_episode: 'log an attack', other: 'anything else' } },
  },
};

type Answers = { model: string; answers: Record<string, Record<string, unknown>>; usage: Record<string, unknown> };

describe('jevAnswersWith', () => {
  test('answers the overrides and 0.02 for every other Noul, with probabilities and usage', () => {
    const reply = jevAnswersWith(REQUEST, { g_dose_advice: 0.95, intent: 'log_dose' }) as Answers;
    expect(reply.answers.g_dose_advice).toEqual({ type: 'noul', noul: 0.95 });
    expect(reply.answers.g_ungrounded_number).toEqual({ type: 'noul', noul: 0.02 });
    const intent = reply.answers.intent;
    expect(intent?.type).toBe('choice');
    expect(intent?.choice).toBe('log_dose');
    expect(typeof intent?.confidence).toBe('number');
    const probabilities = intent?.probabilities as Record<string, number>;
    expect(Object.keys(probabilities).sort()).toEqual(['log_dose', 'log_episode', 'other']);
    expect(Object.values(probabilities).reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
    expect(Math.max(...Object.values(probabilities))).toBe(probabilities.log_dose);
    expect(reply.usage).toEqual({ input_tokens: expect.any(Number) as number, output_tokens: 0 });
    expect(typeof reply.model).toBe('string');
  });

  test('every Choice is `other` unless overridden', () => {
    const reply = jevAnswersWith(REQUEST, {}) as Answers;
    expect(reply.answers.intent?.choice).toBe('other');
    expect(reply.answers.g_dose_advice).toEqual({ type: 'noul', noul: 0.02 });
  });

  test('an override of the wrong kind, for no question, or naming no option, throws instead of passing silently', () => {
    expect(() => jevAnswersWith(REQUEST, { intent: 0.9 })).toThrow(/intent/);
    expect(() => jevAnswersWith(REQUEST, { g_dose_advice: 'yes' })).toThrow(/g_dose_advice/);
    expect(() => jevAnswersWith(REQUEST, { g_missing: 0.9 })).toThrow(/g_missing/);
    expect(() => jevAnswersWith(REQUEST, { intent: 'log_dos' })).toThrow(/log_dos/);
  });

  test('a Choice with no `other` option defaults to its first option, never a phantom one', () => {
    const request = { ...REQUEST, questions: { pick: { type: 'choice', criteria: { first: 'a', second: 'b' } } } };
    const answer = (jevAnswersWith(request, {}) as Answers).answers.pick;
    expect(answer?.choice).toBe('first');
    expect(Object.keys(answer?.probabilities as Record<string, number>).sort()).toEqual(['first', 'second']);
  });

  test('a Score is the probability-weighted level, as System One defines it, not the chosen index', () => {
    const request = { ...REQUEST, questions: { severity: { type: 'score', criteria: ['none', 'some', 'severe'] } } };
    const answer = (jevAnswersWith(request, { severity: 2 }) as Answers).answers.severity;
    const probabilities = answer?.probabilities as Record<string, number>;
    const expected = Object.entries(probabilities).reduce((sum, [level, p]) => sum + Number(level) * p, 0);
    expect(answer?.score).toBeCloseTo(expected);
    expect(answer?.score).not.toBe(2);
    expect(answer?.score).toBeGreaterThan(1.5);
    expect(answer?.legend).toEqual({ '0': 'none', '1': 'some', '2': 'severe' });
    expect(() => jevAnswersWith(request, { severity: 3 })).toThrow(/severity/);
  });
});

describe('startMockServices', () => {
  let mock: MockServices;
  const url = 'http://127.0.0.1:54518';

  beforeAll(async () => {
    mock = await startMockServices();
  });

  afterAll(async () => {
    await mock.close();
  });

  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(`${url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('answers POST /v1/systemone with jevAnswersWith(body, {}) by default and records the bodies', async () => {
    const response = await post('/v1/systemone', REQUEST);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(jevAnswersWith(REQUEST, {}));
    expect(mock.jevRequests()).toEqual([REQUEST]);
  });

  test('respondJev sets a fixed reply or one computed from the body', async () => {
    mock.respondJev({ status: 529, body: { detail: 'overloaded' } });
    expect((await post('/v1/systemone', REQUEST)).status).toBe(529);
    mock.respondJev((body) => ({ status: 200, body: jevAnswersWith(body, { intent: 'log_episode' }) }));
    const reply = (await (await post('/v1/systemone', REQUEST)).json()) as Answers;
    expect(reply.answers.intent?.choice).toBe('log_episode');
  });

  test.each(['model', 'state', 'questions'])('a request without `%s` is a 422, as System One validates it', async (field) => {
    const body = Object.fromEntries(Object.entries(REQUEST).filter(([key]) => key !== field));
    const response = await post('/v1/systemone', body);
    expect(response.status).toBe(422);
    const { detail } = (await response.json()) as { detail: { loc: string[]; type: string }[] };
    expect(detail).toEqual([expect.objectContaining({ loc: ['body', field], type: 'missing' })]);
  });

  test('records the headers of each call, in order with the bodies', async () => {
    const before = mock.jevHeaders().length;
    await fetch(`${url}/v1/systemone`, {
      method: 'POST',
      headers: { authorization: 'Bearer local-only-not-a-key', 'content-type': 'application/json' },
      body: JSON.stringify(REQUEST),
    });
    const headers = mock.jevHeaders();
    expect(headers).toHaveLength(mock.jevRequests().length);
    expect(headers.at(before)).toMatchObject({ authorization: 'Bearer local-only-not-a-key', 'content-type': 'application/json' });
  });

  test('any other path is a 404 and is not recorded', async () => {
    const before = mock.jevRequests().length;
    expect((await post('/v1/forecast', {})).status).toBe(404);
    expect(mock.jevRequests()).toHaveLength(before);
  });
});
