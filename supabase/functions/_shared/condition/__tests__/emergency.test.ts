/** @jest-environment node */
import { emergencyNumber } from '../emergency.ts';

test.each([
  ['US', '911'],
  ['MX', '911'],
  ['BR', '192'],
  ['CO', '123'],
  ['CL', '131'],
  ['AR', '107'],
  ['ES', '112'],
  ['PT', '112'],
  ['PR', '911'],
  ['HN', '911'],
  ['CU', '104'],
  ['VE', '911'],
  ['GT', '122'],
])('%s calls %s', (region, number) => {
  expect(emergencyNumber(region)).toBe(number);
});

test('the region code is case-insensitive', () => {
  expect(emergencyNumber('br')).toBe('192');
});

test('an unknown or missing region has no number', () => {
  expect(emergencyNumber('ZZ')).toBeNull();
  // No number confirmed as operating: Bolivia's 168, Paraguay's 141 and Nicaragua's former Red Cross 128.
  expect(emergencyNumber('BO')).toBeNull();
  expect(emergencyNumber('PY')).toBeNull();
  expect(emergencyNumber('NI')).toBeNull();
  expect(emergencyNumber(null)).toBeNull();
  expect(emergencyNumber('')).toBeNull();
});

test('every number is digits only, so it can go straight into a tel: link', () => {
  for (const region of ['US', 'CA', 'GB', 'ES', 'PT', 'MX', 'BR', 'AR', 'CL', 'CO', 'PE', 'EC', 'UY', 'CR', 'PA', 'DO', 'SV', 'PR', 'HN', 'CU', 'VE', 'GT']) {
    expect(emergencyNumber(region)).toMatch(/^\d{3}$/);
  }
});
