import { monthGrid } from '../monthGrid';

test('November 2026 starts on a Sunday: six leading blanks in week 1, and 30 November opens a sixth week', () => {
  const weeks = monthGrid(2026, 10);
  expect(weeks).toHaveLength(6);
  expect(weeks[0]).toEqual([null, null, null, null, null, null, 1]);
  expect(weeks[4]).toEqual([23, 24, 25, 26, 27, 28, 29]);
  expect(weeks[5]).toEqual([30, null, null, null, null, null, null]);
});

test('every week has seven cells and every day appears once, in order', () => {
  const weeks = monthGrid(2026, 10);
  expect(weeks.every((week) => week.length === 7)).toBe(true);
  expect(weeks.flat().filter((day) => day !== null)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
});

test('February 2027 starts on a Monday: no leading blanks, four full weeks', () => {
  const weeks = monthGrid(2027, 1);
  expect(weeks[0]?.[0]).toBe(1);
  expect(weeks).toHaveLength(4);
  expect(weeks.flat()).toEqual(Array.from({ length: 28 }, (_, index) => index + 1));
});

test('a leap February has 29 days', () => {
  expect(monthGrid(2028, 1).flat().filter((day) => day !== null)).toHaveLength(29);
});
