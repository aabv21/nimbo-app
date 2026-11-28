import { todaySections } from '../todaySections';

test.each([
  // The base order per priority, with the check-in done and medication within its limits.
  ['fewer', 'ok', true, ['signals', 'checkin', 'medication']],
  ['triggers', 'ok', true, ['signals', 'checkin', 'medication']],
  ['overuse', 'ok', true, ['medication', 'signals', 'checkin']],
  ['logging', 'ok', true, ['signals', 'medication', 'checkin']],
  [null, 'ok', true, ['signals', 'medication', 'checkin']],
  // A pending check-in comes first.
  ['fewer', 'ok', false, ['checkin', 'signals', 'medication']],
  ['triggers', 'ok', false, ['checkin', 'signals', 'medication']],
  ['overuse', 'ok', false, ['checkin', 'medication', 'signals']],
  ['logging', 'ok', false, ['checkin', 'signals', 'medication']],
  [null, 'ok', false, ['checkin', 'signals', 'medication']],
  // Medication above its limits comes first, ahead of a pending check-in too.
  ['fewer', 'warn', true, ['medication', 'signals', 'checkin']],
  ['triggers', 'limit', true, ['medication', 'signals', 'checkin']],
  ['overuse', 'warn', true, ['medication', 'signals', 'checkin']],
  ['logging', 'limit', true, ['medication', 'signals', 'checkin']],
  [null, 'warn', true, ['medication', 'signals', 'checkin']],
  ['fewer', 'warn', false, ['medication', 'checkin', 'signals']],
  ['triggers', 'limit', false, ['medication', 'checkin', 'signals']],
  ['overuse', 'limit', false, ['medication', 'checkin', 'signals']],
  ['logging', 'warn', false, ['medication', 'checkin', 'signals']],
  [null, 'limit', false, ['medication', 'checkin', 'signals']],
] as const)('priority %s, medication %s, check-in done %s: %j', (priority, overuseLevel, checkinDone, expected) => {
  expect(todaySections({ priority, overuseLevel, checkinDone })).toEqual(expected);
});
