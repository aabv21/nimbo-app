import { FUNCTION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, fetchWithTimeout } from '../fetchWithTimeout';

const originalFetch = globalThis.fetch;
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit | undefined]>();

/** A request that never answers on its own: like `fetch`, it only settles when its signal aborts. */
function hangingRequest(_input: RequestInfo | URL, init: RequestInit | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = (): void => {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    if (init?.signal?.aborted === true) {
      abort();
      return;
    }
    init?.signal?.addEventListener('abort', abort);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

test('the timeout is about 12 seconds', () => {
  expect(REQUEST_TIMEOUT_MS).toBe(12_000);
});

test('aborts a request that has not answered after the timeout', async () => {
  fetchMock.mockImplementation(hangingRequest);

  const request = fetchWithTimeout('http://127.0.0.1:54521/rest/v1/profiles', { method: 'GET' });
  const outcome = request.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
  );

  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS - 1);
  await Promise.resolve();
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

  jest.advanceTimersByTime(1);
  expect(await outcome).toBe('AbortError');
});

/** Starts `request` and reports, without throwing, how it settled. */
function outcomeOf(request: Promise<Response>): Promise<string> {
  return request.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.name : 'unknown'),
  );
}

test('Edge Function POSTs get 45 seconds', () => {
  expect(FUNCTION_TIMEOUT_MS).toBe(45_000);
});

test('a POST to /functions/v1/ survives 30 s and aborts at 45 s', async () => {
  fetchMock.mockImplementation(hangingRequest);

  const outcome = outcomeOf(
    fetchWithTimeout('http://127.0.0.1:54521/functions/v1/companion', { method: 'POST', body: '{}' }),
  );

  jest.advanceTimersByTime(30_000);
  await Promise.resolve();
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

  jest.advanceTimersByTime(FUNCTION_TIMEOUT_MS - 30_000 - 1);
  await Promise.resolve();
  expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

  jest.advanceTimersByTime(1);
  expect(await outcome).toBe('AbortError');
});

test('a GET to /functions/v1/ keeps the 12 s deadline (only POSTs get the longer budget)', async () => {
  fetchMock.mockImplementation(hangingRequest);

  const outcome = outcomeOf(
    fetchWithTimeout('http://127.0.0.1:54521/functions/v1/companion', { method: 'GET' }),
  );

  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
  expect(await outcome).toBe('AbortError');
});

test('a REST GET still aborts at 12 s', async () => {
  fetchMock.mockImplementation(hangingRequest);

  const outcome = outcomeOf(fetchWithTimeout(new URL('http://127.0.0.1:54521/rest/v1/profiles?select=*')));

  jest.advanceTimersByTime(REQUEST_TIMEOUT_MS);
  expect(await outcome).toBe('AbortError');
});

test('passes the request through and leaves no timer behind when it answers in time', async () => {
  const response = { ok: true } as Response;
  fetchMock.mockResolvedValue(response);

  await expect(fetchWithTimeout('http://x/', { method: 'POST', body: '{}' })).resolves.toBe(response);

  expect(fetchMock).toHaveBeenCalledWith('http://x/', expect.objectContaining({ method: 'POST', body: '{}' }));
  expect(jest.getTimerCount()).toBe(0);
});

test("a caller's own abort still cancels the request", async () => {
  fetchMock.mockImplementation(hangingRequest);
  const caller = new AbortController();

  const request = fetchWithTimeout('http://x/', { signal: caller.signal });
  caller.abort();

  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});

test("once the request settles, it stops listening to the caller's signal", async () => {
  fetchMock.mockResolvedValue({ ok: true } as Response);
  const caller = new AbortController();
  const removeListener = jest.spyOn(caller.signal, 'removeEventListener');

  await fetchWithTimeout('http://x/', { signal: caller.signal });

  expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
});

test('a signal that is already aborted cancels at once', async () => {
  fetchMock.mockImplementation(hangingRequest);
  const caller = new AbortController();
  caller.abort();

  await expect(fetchWithTimeout('http://x/', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});
