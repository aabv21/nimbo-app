import { toRequestErrorKind, toThrownErrorKind } from '../requestResult';

test.each([
  [{ code: '' }, 0, 'network'],
  [{}, 0, 'network'],
  [{ code: '23514' }, 400, 'invalid'],
  [{ code: '22001' }, 400, 'invalid'],
  [{ code: '22023' }, 400, 'invalid'],
  [{ code: '42501' }, 403, 'unknown'],
  [{}, 500, 'unknown'],
] as const)('error %p with status %p is %s', (error, status, kind) => {
  expect(toRequestErrorKind(error, status)).toBe(kind);
});

test('a thrown TypeError is a network failure and anything else is unknown', () => {
  expect(toThrownErrorKind(new TypeError('Network request failed'))).toBe('network');
  expect(toThrownErrorKind(new Error('boom'))).toBe('unknown');
  expect(toThrownErrorKind('boom')).toBe('unknown');
});
