// `pnpm premium` against the running local stack: grant, revoke, and a purchase the script never touches.

import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { signInWithEmail } from '../src/auth/emailAuth';
import { main, runPremium } from '../scripts/premium';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const users: string[] = [];

afterAll(async () => {
  await Promise.all(users.map((id) => deleteUser(id)));
});

async function signedIn(label: string) {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { email, id, client };
}

async function premiumOf(client: ReturnType<typeof anonClient>, id: string): Promise<boolean | null> {
  const { data, error } = await client.rpc('has_premium', { p_user: id });
  expect(error).toBeNull();
  return data;
}

test('grant makes the user premium, revoke takes it away, and the rows are returned', async () => {
  const { email, id, client } = await signedIn('premium-grant');
  expect(await premiumOf(client, id)).toBe(false);

  const granted = await runPremium({ action: 'grant', email, note: 'beta tester', until: null }, serviceClient());
  expect(granted.before).toBeNull();
  expect(granted.after).toMatchObject({ user_id: id, granted: true, granted_until: null, granted_note: 'beta tester' });
  expect(await premiumOf(client, id)).toBe(true);

  const revoked = await runPremium({ action: 'revoke', email }, serviceClient());
  expect(revoked.before).toMatchObject({ granted: true });
  expect(revoked.after).toMatchObject({ granted: false, granted_until: null, granted_note: 'beta tester' });
  expect(await premiumOf(client, id)).toBe(false);
});

test('a purchase set by the service role survives a revoke', async () => {
  const { email, id, client } = await signedIn('premium-purchase');
  await runPremium({ action: 'grant', email, note: null, until: null }, serviceClient());
  const future = new Date(Date.now() + 86_400_000 * 30).toISOString();
  const { error } = await serviceClient()
    .from('entitlements')
    .update({ purchase_active: true, purchase_expires_at: future, purchase_source: 'test' })
    .eq('user_id', id);
  expect(error).toBeNull();

  const { after } = await runPremium({ action: 'revoke', email }, serviceClient());
  expect(after).toMatchObject({ granted: false, purchase_active: true, purchase_source: 'test' });
  expect(await premiumOf(client, id)).toBe(true);
});

test('a user cannot write their own entitlement, nor ask about another user', async () => {
  const a = await signedIn('premium-a');
  const b = await signedIn('premium-b');
  const write = await a.client.from('entitlements').insert({ user_id: a.id, granted: true });
  expect(write.error?.code).toBe('42501');
  const other = await a.client.rpc('has_premium', { p_user: b.id });
  expect(other.error?.code).toBe('42501');
});

test('an unknown email is an error', async () => {
  await expect(
    runPremium({ action: 'grant', email: uniqueEmail('premium-nobody'), note: null, until: null }, serviceClient()),
  ).rejects.toThrow(/no user/i);
});

test('the command prints the row before and after as JSON', async () => {
  const { email } = await signedIn('premium-print');
  const lines: string[] = [];
  const code = await main(['grant', email, '--note', 'printed'], process.env, {
    createClient: () => serviceClient(),
    now: () => new Date(),
    log: (line) => lines.push(line),
    error: () => undefined,
  });
  expect(code).toBe(0);
  const text = lines.join('\n');
  expect(text).toContain('before');
  expect(text).toContain('after');
  expect(text).toContain('"granted": true');
  expect(text).toContain('printed');
});
