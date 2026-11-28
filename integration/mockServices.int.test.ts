// The mock Jev's and Open-Meteo's answers and routes; it needs no local stack, only its own port.

import { jevAnswersWith, type MockServices, pressureForecast, startMockServices } from './mockServices';

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

  test('any other path or method is a 404 and is not recorded', async () => {
    const before = mock.jevRequests().length;
    const forecasts = mock.forecastRequests().length;
    expect((await post('/v1/other', {})).status).toBe(404);
    expect((await post('/v1/forecast', {})).status).toBe(404);
    expect(mock.jevRequests()).toHaveLength(before);
    expect(mock.forecastRequests()).toHaveLength(forecasts);
  });

  describe('the Open-Meteo forecast route', () => {
    const FORECAST = 'http://127.0.0.1:54518/v1/forecast?latitude=4.6&longitude=-74.1&hourly=pressure_msl&forecast_hours=28&timezone=GMT';

    type Forecast = { utc_offset_seconds: number; timezone: string; hourly: { time: string[]; pressure_msl: (number | null)[] } };

    test('answers 28 hours of 1013.0 hPa from the current UTC hour by default, and records the URL', async () => {
      const hour = new Date().toISOString().slice(0, 13);
      const response = await fetch(FORECAST);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Forecast;
      expect(body.utc_offset_seconds).toBe(0);
      expect(body.timezone).toBe('GMT');
      expect(body.hourly.time).toHaveLength(28);
      expect(body.hourly.pressure_msl).toEqual(Array.from({ length: 28 }, () => 1013));
      // Unless the test straddles an hour boundary, the first hour is the one in progress.
      expect([hour, new Date().toISOString().slice(0, 13)]).toContain(body.hourly.time[0]?.slice(0, 13));
      expect(body.hourly.time[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/);
      expect(mock.forecastRequests().at(-1)?.searchParams.get('latitude')).toBe('4.6');
    });

    test('respondForecast sets a fixed reply or one computed from the URL', async () => {
      mock.respondForecast({ status: 429, body: { error: true, reason: 'Daily API request limit exceeded' } });
      expect((await fetch(FORECAST)).status).toBe(429);
      mock.respondForecast((url) => ({ status: 200, body: pressureForecast([1012.4, null], new Date('2026-11-27T13:00:00Z'), url) }));
      const body = (await (await fetch(FORECAST)).json()) as Forecast & { latitude: number };
      expect(body.hourly).toEqual({ time: ['2026-11-27T13:00', '2026-11-27T14:00'], pressure_msl: [1012.4, null] });
      expect(body.latitude).toBe(4.6);
    });

    test.each([
      ['no latitude', 'longitude=-74.1&hourly=pressure_msl'],
      ['a latitude past the pole', 'latitude=91&longitude=-74.1&hourly=pressure_msl'],
      ['a longitude that is no number', 'latitude=4.6&longitude=west&hourly=pressure_msl'],
      ['an unknown hourly variable', 'latitude=4.6&longitude=-74.1&hourly=pressure'],
      ['forecast_hours past 16 days', 'latitude=4.6&longitude=-74.1&hourly=pressure_msl&forecast_hours=400'],
      ['an unknown time zone', 'latitude=4.6&longitude=-74.1&hourly=pressure_msl&timezone=Mars/Base'],
    ])('%s is a 400 with a reason, as Open-Meteo answers', async (_label, query) => {
      mock.respondForecast({ status: 200, body: {} });
      const response = await fetch(`http://127.0.0.1:54518/v1/forecast?${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: true, reason: expect.any(String) as string });
    });
  });

  describe('the Expo push routes', () => {
    type Tickets = { data: { status: string; id: string }[] };

    test('send answers an ok ticket with a fresh id per message by default, and records the messages', async () => {
      const messages = [{ to: 'ExponentPushToken[a]', title: 't' }, { to: 'ExponentPushToken[b]', title: 't' }];
      const response = await post('/--/api/v2/push/send', messages);
      expect(response.status).toBe(200);
      const { data } = (await response.json()) as Tickets;
      expect(data.map((ticket) => ticket.status)).toEqual(['ok', 'ok']);
      expect(new Set(data.map((ticket) => ticket.id)).size).toBe(2);
      expect(mock.pushRequests().at(-1)).toEqual(messages);
    });

    test('respondPush sets a fixed reply or one computed from the messages', async () => {
      mock.respondPush({ status: 500, body: {} });
      expect((await post('/--/api/v2/push/send', [{ to: 'x' }])).status).toBe(500);
      mock.respondPush((messages) => ({ status: 200, body: { data: messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) } }));
      const body = (await (await post('/--/api/v2/push/send', [{ to: 'x' }])).json()) as { data: { details: { error: string } }[] };
      expect(body.data[0]?.details.error).toBe('DeviceNotRegistered');
    });

    test('getReceipts answers ok for every id by default, records the ids, and respondReceipts overrides it', async () => {
      const response = await post('/--/api/v2/push/getReceipts', { ids: ['r1', 'r2'] });
      expect(await response.json()).toEqual({ data: { r1: { status: 'ok' }, r2: { status: 'ok' } } });
      expect(mock.receiptRequests().at(-1)).toEqual(['r1', 'r2']);
      mock.respondReceipts((ids) => ({ status: 200, body: { data: Object.fromEntries(ids.map((id) => [id, { status: 'error', details: { error: 'DeviceNotRegistered' } }])) } }));
      const dead = (await (await post('/--/api/v2/push/getReceipts', { ids: ['r3'] })).json()) as { data: Record<string, unknown> };
      expect(dead.data).toEqual({ r3: { status: 'error', details: { error: 'DeviceNotRegistered' } } });
    });
  });
});
