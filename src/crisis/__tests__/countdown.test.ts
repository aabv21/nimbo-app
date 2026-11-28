import { minutesLeft, nextDoseAt, resolveDoseTime } from '../countdown';

const SAO_PAULO = 'America/Sao_Paulo';

describe('nextDoseAt', () => {
  test('a dose at 15:55 with an 8 h interval allows the next one from 23:55', () => {
    expect(nextDoseAt(new Date('2026-11-26T15:55:00Z'), 480)).toEqual(new Date('2026-11-26T23:55:00Z'));
  });

  test('no interval or no dose means no countdown', () => {
    expect(nextDoseAt(new Date('2026-11-26T15:55:00Z'), null)).toBeNull();
    expect(nextDoseAt(null, 480)).toBeNull();
  });
});

describe('minutesLeft', () => {
  const next = new Date('2026-11-26T23:55:00Z');

  test('a part minute counts as a whole one', () => {
    expect(minutesLeft(next, new Date('2026-11-26T23:54:30Z'))).toBe(1);
    expect(minutesLeft(next, new Date('2026-11-26T15:55:00Z'))).toBe(480);
  });

  test('it never goes below 0', () => {
    expect(minutesLeft(next, next)).toBe(0);
    expect(minutesLeft(next, new Date('2026-11-27T00:30:00Z'))).toBe(0);
  });
});

describe('resolveDoseTime', () => {
  // 00:10 on 1 December in São Paulo (UTC−3).
  const justAfterMidnight = new Date('2026-12-01T03:10:00Z');

  test('"23:50" typed at 00:10 is 23:50 the previous day', () => {
    expect(resolveDoseTime({ hours: 23, minutes: 50 }, justAfterMidnight, SAO_PAULO)).toEqual(new Date('2026-12-01T02:50:00Z'));
  });

  test('"0:05" typed at 00:10 is today', () => {
    expect(resolveDoseTime({ hours: 0, minutes: 5 }, justAfterMidnight, SAO_PAULO)).toEqual(new Date('2026-12-01T03:05:00Z'));
  });

  test('the current minute is today', () => {
    expect(resolveDoseTime({ hours: 0, minutes: 10 }, new Date('2026-12-01T03:10:40Z'), SAO_PAULO)).toEqual(
      new Date('2026-12-01T03:10:00Z'),
    );
  });

  test('the wall clock of the zone is used, not UTC', () => {
    // 08:30 on 1 December in Tokyo (UTC+9) is still 30 November in UTC.
    const tokyoMorning = new Date('2026-11-30T23:30:00Z');
    expect(resolveDoseTime({ hours: 7, minutes: 0 }, tokyoMorning, 'Asia/Tokyo')).toEqual(new Date('2026-11-30T22:00:00Z'));
    expect(resolveDoseTime({ hours: 9, minutes: 0 }, tokyoMorning, 'Asia/Tokyo')).toEqual(new Date('2026-11-30T00:00:00Z'));
  });

  test('a time across a daylight-saving change keeps its wall clock', () => {
    // New York falls back on 1 November 2026: 01:30 the next morning is EST (UTC−5).
    const morning = new Date('2026-11-01T12:00:00Z');
    expect(resolveDoseTime({ hours: 1, minutes: 30 }, morning, 'America/New_York').getTime()).toBeLessThan(morning.getTime());
    expect(resolveDoseTime({ hours: 6, minutes: 0 }, morning, 'America/New_York')).toEqual(new Date('2026-11-01T11:00:00Z'));
    // 23:00 the evening before was still EDT (UTC−4).
    expect(resolveDoseTime({ hours: 23, minutes: 0 }, new Date('2026-11-01T05:30:00Z'), 'America/New_York')).toEqual(
      new Date('2026-11-01T03:00:00Z'),
    );
  });
});
