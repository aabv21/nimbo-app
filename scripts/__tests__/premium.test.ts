/** @jest-environment node */
// scripts/__tests__/premium.test.ts
import { main, parsePremiumArgs, runPremium } from '../premium.ts';
import type { PremiumCommand } from '../premium.ts';

const NOW = new Date('2026-11-27T12:00:00Z');

test('grant parses the email, the note and the end date', () => {
  expect(parsePremiumArgs(['grant', 'a@b.co', '--until', '2027-01-01', '--note', 'tester'], NOW)).toEqual({
    action: 'grant',
    email: 'a@b.co',
    note: 'tester',
    until: '2027-01-01',
  });
});

test('grant without flags is open-ended and has no note', () => {
  expect(parsePremiumArgs(['grant', 'a@b.co'], NOW)).toEqual({ action: 'grant', email: 'a@b.co', note: null, until: null });
});

test('revoke takes only an email', () => {
  expect(parsePremiumArgs(['revoke', 'a@b.co'], NOW)).toEqual({ action: 'revoke', email: 'a@b.co' });
});

test.each([
  ['a past --until', ['grant', 'a@b.co', '--until', '2026-11-26']],
  ['a malformed --until', ['grant', 'a@b.co', '--until', '2027-02-30']],
  ['an unknown flag', ['grant', 'a@b.co', '--forever']],
  ['a missing email', ['grant']],
  ['a flag in place of the email', ['grant', '--note', 'x']],
  ['an unknown action', ['gift', 'a@b.co']],
  ['no arguments', []],
  ['a flag on revoke', ['revoke', 'a@b.co', '--note', 'x']],
  ['a flag with no value', ['grant', 'a@b.co', '--note']],
])('%s is a usage error', (_label, argv) => {
  expect(() => parsePremiumArgs(argv, NOW)).toThrow(/usage/i);
});

test('today is still allowed as an end date', () => {
  expect(parsePremiumArgs(['grant', 'a@b.co', '--until', '2026-11-27'], NOW)).toMatchObject({ until: '2026-11-27' });
});

test('without the service-role key it exits 1 before any client is created', async () => {
  let created = 0;
  const createClient = (): never => {
    created += 1;
    throw new Error('no client expected');
  };
  const errors: string[] = [];
  const code = await main(['grant', 'a@b.co'], { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54521' }, {
    createClient,
    now: () => NOW,
    log: () => undefined,
    error: (line) => errors.push(line),
  });
  expect(code).toBe(1);
  expect(created).toBe(0);
  expect(errors.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY');
});

test('a usage error exits 2 without a client', async () => {
  let created = 0;
  const createClient = (): never => {
    created += 1;
    throw new Error('no client expected');
  };
  const code = await main(['grant'], { SUPABASE_SERVICE_ROLE_KEY: 'k', EXPO_PUBLIC_SUPABASE_URL: 'http://x' }, {
    createClient,
    now: () => NOW,
    log: () => undefined,
    error: () => undefined,
  });
  expect(code).toBe(2);
  expect(created).toBe(0);
});

function fakeClient() {
  const upserts: Record<string, unknown>[] = [];
  const client = {
    auth: { admin: { listUsers: () => Promise.resolve({ data: { users: [{ id: 'u1', email: 'A@b.co' }] }, error: null }) } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  };
  return { client: client as unknown as Parameters<typeof runPremium>[1], upserts };
}

async function sent(command: PremiumCommand): Promise<Record<string, unknown>> {
  const { client, upserts } = fakeClient();
  await runPremium(command, client);
  const row = upserts[0];
  if (row === undefined) throw new Error('nothing was written');
  return row;
}

test('a note-less grant omits granted_note, so the stored note stays', async () => {
  const row = await sent({ action: 'grant', email: 'a@b.co', note: null, until: null });
  expect('granted_note' in row).toBe(false);
  expect(row).toMatchObject({ user_id: 'u1', granted: true, granted_until: null });
});

test('--until becomes the end of that UTC day', async () => {
  const row = await sent({ action: 'grant', email: 'a@b.co', note: 'x', until: '2027-01-01' });
  expect(row['granted_until']).toBe('2027-01-01T23:59:59.999Z');
  expect(row['granted_note']).toBe('x');
});

test('no purchase column is ever sent', async () => {
  const keys = [
    ...Object.keys(await sent({ action: 'grant', email: 'a@b.co', note: 'x', until: '2027-01-01' })),
    ...Object.keys(await sent({ action: 'revoke', email: 'a@b.co' })),
  ];
  expect(keys.filter((key) => key.startsWith('purchase_'))).toEqual([]);
});

test('a run names the target host before acting', async () => {
  const errors: string[] = [];
  await main(['grant'], { SUPABASE_SERVICE_ROLE_KEY: 'k', EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' }, {
    createClient: () => {
      throw new Error('no client expected');
    },
    now: () => NOW,
    log: () => undefined,
    error: (line) => errors.push(line),
  });
  expect(errors[0]).toBe('Target: abc.supabase.co');
});
