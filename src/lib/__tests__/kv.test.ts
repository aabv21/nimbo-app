import { allowUserKeys, kvGet, kvGetJson, kvKeys, kvRemove, kvSet, kvUserRefused, parseJson, refuseUserKeys } from '../kv';

const isPair = (value: unknown): value is { a: number } =>
  typeof value === 'object' && value !== null && typeof (value as { a?: unknown }).a === 'number';

afterEach(() => {
  kvRemove('test.json');
});

test('kvGetJson reads a stored value that passes the guard', () => {
  kvSet('test.json', '{"a":1}');
  expect(kvGetJson('test.json', isPair)).toEqual({ a: 1 });
});

test('kvGetJson is null for a missing key, invalid JSON or a guard miss', () => {
  expect(kvGetJson('test.json', isPair)).toBeNull();
  kvSet('test.json', 'not json');
  expect(kvGetJson('test.json', isPair)).toBeNull();
  kvSet('test.json', '{"a":"1"}');
  expect(kvGetJson('test.json', isPair)).toBeNull();
});

test('parseJson reads a raw value the same way', () => {
  expect(parseJson('{"a":2}', isPair)).toEqual({ a: 2 });
  expect(parseJson(null, isPair)).toBeNull();
  expect(parseJson('{', isPair)).toBeNull();
});

describe('the post-deletion guard', () => {
  afterEach(() => {
    allowUserKeys('u1');
    for (const key of kvKeys()) kvRemove(key);
  });

  test("after refuseUserKeys, a key with the user's id as any segment stores nothing, and another user's still stores", () => {
    refuseUserKeys('u1');

    kvSet('profile.u1', 'x');
    kvSet('companion.quota.companion.u1.2026-12-01', '1');
    kvSet('profile.u2', 'x');

    expect(kvGet('profile.u1')).toBeNull();
    expect(kvGet('companion.quota.companion.u1.2026-12-01')).toBeNull();
    expect(kvGet('profile.u2')).toBe('x');
    expect(kvUserRefused('u1')).toBe(true);
  });

  test('a segment only containing the id is not refused', () => {
    refuseUserKeys('u1');

    kvSet('profile.u10', 'x');

    expect(kvGet('profile.u10')).toBe('x');
  });

  test('allowUserKeys lifts it', () => {
    refuseUserKeys('u1');
    allowUserKeys('u1');

    kvSet('profile.u1', 'x');

    expect(kvGet('profile.u1')).toBe('x');
    expect(kvUserRefused('u1')).toBe(false);
  });

  test('kvKeys lists the stored keys', () => {
    kvSet('a.one', '1');
    kvSet('b.two', '2');

    expect(kvKeys().sort()).toEqual(['a.one', 'b.two']);
  });
});
