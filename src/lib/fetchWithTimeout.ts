/**
 * Without it a captive portal or dead connection holds a request (and a spinner) for the platform's
 * own ~1 min timeout; an aborted request surfaces as a network error.
 */
export const REQUEST_TIMEOUT_MS = 12_000;

/** An Edge Function call can wait on a model's reply, so function POSTs get a longer deadline. */
export const FUNCTION_TIMEOUT_MS = 45_000;

const FUNCTIONS_PATH = '/functions/v1/';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function deadlineFor(input: RequestInfo | URL, init: RequestInit): number {
  const method = (init.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  return method === 'POST' && urlOf(input).includes(FUNCTIONS_PATH) ? FUNCTION_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
}

/**
 * A caller's own signal still cancels, and is unsubscribed once the request settles. Not
 * `AbortSignal.timeout`/`.any`, which React Native doesn't reliably provide.
 */
export function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  const timer = setTimeout(abort, deadlineFor(input, init));
  const callerSignal = init.signal ?? undefined;
  if (callerSignal?.aborted === true) {
    abort();
  } else {
    callerSignal?.addEventListener('abort', abort, { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abort);
  });
}
