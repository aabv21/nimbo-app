import { classifyRpcError } from '../errors';

test('no error is a success', () => {
  expect(classifyRpcError(null, 204)).toEqual({ ok: true });
});

test.each([
  ['22023', 400],
  ['23514', 400],
  ['23502', 400],
  ['22P02', 400],
  ['22001', 400],
  ['22003', 400],
  // PostgREST's own statuses for these codes, as the local stack answers them.
  ['P0002', 500],
  ['42501', 403],
])('code %s is permanent', (code, status) => {
  expect(classifyRpcError({ code }, status)).toEqual({ ok: false, permanent: true });
});

test('no response is retryable and flagged, so the attempt is given back', () => {
  expect(classifyRpcError({ code: '' }, 0)).toEqual({ ok: false, permanent: false, noResponse: true });
});

test.each([
  ['a server error', 'XX000', 500],
  ['a gateway error', '', 503],
  ['an expired token', 'PGRST303', 401],
  ['a request sent without a session', '42501', 401],
  ['an unknown client error', 'PGRST000', 400],
])('%s is retryable', (_label, code, status) => {
  expect(classifyRpcError({ code }, status)).toEqual({ ok: false, permanent: false });
});
