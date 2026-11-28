import { localDate } from '../localDate';

test('is the local calendar day, zero-padded', () => {
  expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  expect(localDate(new Date(2026, 11, 1, 0, 1))).toBe('2026-12-01');
});
