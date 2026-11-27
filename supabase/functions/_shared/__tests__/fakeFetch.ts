// A recording `fetch` for the shared-module tests: each call's method, URL, headers and body, and a
// `hanging` answer that ends only when the caller aborts.

export type Call = { method: string; url: URL; headers: Headers; body: string | undefined };

export const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake `fetch` that answers through `answer(call)` and records every call. */
export function fakeFetch(answer: (call: Call, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call: Call = {
      method: init.method ?? 'GET',
      url: new URL(href),
      headers: new Headers(init.headers),
      body: typeof init.body === 'string' ? init.body : undefined,
    };
    calls.push(call);
    return answer(call, init);
  };
  return { fetch, calls };
}

/** Never answers; rejects with an AbortError once the caller's signal aborts. */
export const hanging = (_call: Call, init: RequestInit): Promise<Response> =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    });
  });
