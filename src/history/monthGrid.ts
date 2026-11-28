// The weeks of a month for the calendar, Monday first.

/** `month` is 0-based, as `Date`'s. Weeks of seven cells; `null` pads the days outside the month. */
export function monthGrid(year: number, month: number): readonly (number | null)[][] {
  const days = new Date(year, month + 1, 0).getDate();
  // `getDay()` counts Sunday as 0; Monday-first moves it to the end of the row.
  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, index) => index + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}
