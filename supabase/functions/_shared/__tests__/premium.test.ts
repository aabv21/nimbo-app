/** @jest-environment node */
// supabase/functions/_shared/__tests__/premium.test.ts
import { hasPremium } from '../premium.ts';

function clientAnswering(result: { data: boolean | null; error: unknown }) {
  const calls: { name: string; args: { p_user: string } }[] = [];
  return {
    calls,
    rpc: (name: 'has_premium', args: { p_user: string }) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  };
}

test('it asks has_premium about the user and returns the answer', async () => {
  const client = clientAnswering({ data: true, error: null });
  expect(await hasPremium(client, 'user-1')).toBe(true);
  expect(client.calls).toEqual([{ name: 'has_premium', args: { p_user: 'user-1' } }]);
});

test('false is false', async () => {
  expect(await hasPremium(clientAnswering({ data: false, error: null }), 'user-1')).toBe(false);
});

test('an error is false, never premium', async () => {
  expect(await hasPremium(clientAnswering({ data: true, error: { code: '42501' } }), 'user-1')).toBe(false);
});

test('a null answer is false', async () => {
  expect(await hasPremium(clientAnswering({ data: null, error: null }), 'user-1')).toBe(false);
});

test('a call that throws is false', async () => {
  const client = { rpc: () => Promise.reject(new Error('offline')) };
  expect(await hasPremium(client, 'user-1')).toBe(false);
});
