// profileRepository against the running local stack: the consent round trip, who can read or write
// which profile, and the offline cache the repository fills.

import { signInWithEmail } from '../src/auth/emailAuth';
import {
  acceptTerms,
  fetchProfile,
  readCachedProfile,
  setAiConsent,
  updateProfile,
} from '../src/profile/profileRepository';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';

interface TestUser {
  id: string;
  client: ReturnType<typeof anonClient>;
}

const users: string[] = [];

async function signedInUser(label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client };
}

afterAll(async () => {
  await Promise.all(users.map((id) => deleteUser(id)));
});

test('a new account has a profile with no consent yet, and the fetch caches it', async () => {
  const { id, client } = await signedInUser('profile-new');

  const result = await fetchProfile(client);

  expect(result).toMatchObject({
    ok: true,
    value: {
      adultConfirmedAt: null,
      boundaryAcceptedAt: null,
      aiConsentAnsweredAt: null,
      aiEnabled: false,
      onboardingCompletedAt: null,
      theme: 'day',
    },
  });
  await expect(readCachedProfile(id)).resolves.toEqual(result.ok ? result.value : null);
});

test('acceptTerms then setAiConsent(false) round-trip through the RPCs', async () => {
  const { client } = await signedInUser('profile-consent');

  const accepted = await acceptTerms(client);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) return;
  expect(accepted.value.adultConfirmedAt).not.toBeNull();
  expect(accepted.value.boundaryAcceptedAt).not.toBeNull();
  expect(accepted.value.aiConsentAnsweredAt).toBeNull();

  const declined = await setAiConsent(false, client);
  expect(declined.ok).toBe(true);
  if (!declined.ok) return;
  expect(declined.value.aiEnabled).toBe(false);
  expect(declined.value.aiConsentAnsweredAt).not.toBeNull();
  // The answer is a decision, not a toggle's initial state: the timestamps from the first step stay.
  expect(declined.value.adultConfirmedAt).toBe(accepted.value.adultConfirmedAt);

  const enabled = await setAiConsent(true, client);
  expect(enabled).toMatchObject({ ok: true, value: { aiEnabled: true } });
});

test('updateProfile changes only what it is given', async () => {
  const { client } = await signedInUser('profile-update');

  expect(await updateProfile({ theme: 'dim', language: 'pt' }, client)).toMatchObject({
    ok: true,
    value: { theme: 'dim', language: 'pt', reduceMotion: false },
  });
  expect(await updateProfile({ reduceMotion: true }, client)).toMatchObject({
    ok: true,
    value: { theme: 'dim', language: 'pt', reduceMotion: true },
  });
});

test('a value the database rejects is the invalid kind', async () => {
  const { client } = await signedInUser('profile-invalid');

  // The type allows only 0 | 1 | 2; the cast stands in for a hand-edited request.
  const result = await updateProfile({ notifyDailyCap: 7 as 2 }, client);

  expect(result).toEqual({ ok: false, kind: 'invalid' });
});

test("user A cannot read B's profile, and a hand-edited write of the consent columns is refused", async () => {
  const a = await signedInUser('profile-a');
  const b = await signedInUser('profile-b');

  const { data: seen } = await a.client.from('profiles').select('*').eq('user_id', b.id);
  expect(seen).toEqual([]);

  const own = await fetchProfile(a.client);
  expect(own.ok).toBe(true);

  const { error: consentError } = await a.client.from('profiles').update({ ai_enabled: true }).eq('user_id', a.id);
  expect(consentError).not.toBeNull();
  const { data: stamped } = await a.client
    .from('profiles')
    .update({ adult_confirmed_at: '1999-01-01T00:00:00Z' })
    .eq('user_id', a.id)
    .select();
  expect(stamped ?? []).toEqual([]);

  const { data: others } = await a.client.from('profiles').update({ theme: 'dim' }).eq('user_id', b.id).select();
  expect(others).toEqual([]);
  expect(await fetchProfile(b.client)).toMatchObject({ ok: true, value: { theme: 'day' } });
});

test("a signed-out client gets no profile and the cache keeps each user's own", async () => {
  const a = await signedInUser('profile-cache-a');
  const b = await signedInUser('profile-cache-b');
  await updateProfile({ theme: 'dim' }, a.client);
  await fetchProfile(b.client);

  expect((await fetchProfile(anonClient())).ok).toBe(false);

  await expect(readCachedProfile(a.id)).resolves.toMatchObject({ theme: 'dim' });
  await expect(readCachedProfile(b.id)).resolves.toMatchObject({ theme: 'day' });
});
