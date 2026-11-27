import { formatClock, formatDuration, parseClock } from '../format';

test('formatDuration shows minutes, hours and minutes, or days and hours', () => {
  expect(formatDuration(0)).toBe('0 min');
  expect(formatDuration(45)).toBe('45 min');
  expect(formatDuration(60)).toBe('1 h');
  expect(formatDuration(320)).toBe('5 h 20 min');
  expect(formatDuration(1440)).toBe('1 d');
  expect(formatDuration(4440)).toBe('3 d 2 h');
});

test('formatClock is 12-hour in en and 24-hour in es and pt', () => {
  const afternoon = new Date(2026, 10, 27, 15, 55);
  const morning = new Date(2026, 10, 27, 7, 5);
  const midnight = new Date(2026, 10, 27, 0, 10);
  expect(formatClock(afternoon, 'en')).toBe('3:55 PM');
  expect(formatClock(morning, 'en')).toBe('7:05 AM');
  expect(formatClock(midnight, 'en')).toBe('12:10 AM');
  expect(formatClock(afternoon, 'es')).toBe('15:55');
  expect(formatClock(morning, 'pt')).toBe('07:05');
});

test('parseClock reads H:MM and HH:MM', () => {
  expect(parseClock('22:10')).toEqual({ hours: 22, minutes: 10 });
  expect(parseClock('7:05')).toEqual({ hours: 7, minutes: 5 });
  expect(parseClock(' 0:00 ')).toEqual({ hours: 0, minutes: 0 });
});

test('parseClock rejects anything else', () => {
  for (const text of ['25:00', '2210', '', '12:60', '1:5', 'ab:cd', '-1:00']) {
    expect(parseClock(text)).toBeNull();
  }
});
