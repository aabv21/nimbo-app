// profileRepository against the running local stack: the consent round trip, who can read or write
// which profile, and the offline cache the app's provider fills.

import { signInWithEmail } from '../src/auth/emailAuth';
import {
  acceptTerms,
  fetchProfile,
  readCachedProfileSync,
  setAiConsent,
  updateProfile,
  writeCachedProfile,
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

test('a new account has a profile with no consent yet, and the fetch leaves the cache alone', async () => {
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
      termsVersion: null,
      aiConsentVersion: null,
      theme: 'system',
    },
  });
  expect(readCachedProfileSync(id)).toBeNull();
});

test('acceptTerms then setAiConsent(false) round-trip through the RPCs', async () => {
  const { client } = await signedInUser('profile-consent');

  const accepted = await acceptTerms('en', client);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) return;
  expect(accepted.value.adultConfirmedAt).not.toBeNull();
  expect(accepted.value.boundaryAcceptedAt).not.toBeNull();
  expect(accepted.value.aiConsentAnsweredAt).toBeNull();

  const declined = await setAiConsent(false, 'es', client);
  expect(declined.ok).toBe(true);
  if (!declined.ok) return;
  expect(declined.value.aiEnabled).toBe(false);
  expect(declined.value.aiConsentAnsweredAt).not.toBeNull();
  expect(declined.value.aiConsentVersion).toBe('2026-12-01');
  // The answer is a decision, not a toggle's initial state: the timestamps from the first step stay.
  expect(declined.value.adultConfirmedAt).toBe(accepted.value.adultConfirmedAt);

  const enabled = await setAiConsent(true, 'en', client);
  expect(enabled).toMatchObject({ ok: true, value: { aiEnabled: true } });

  // Each answer is kept in the history the user can read, with the language it was given in.
  const { data: events } = await client.from('consent_events').select('kind,version,locale,granted').order('created_at');
  expect(events).toEqual([
    { kind: 'terms', version: '2026-12-01', locale: 'en', granted: true },
    { kind: 'ai', version: '2026-12-01', locale: 'es', granted: false },
    { kind: 'ai', version: '2026-12-01', locale: 'en', granted: true },
  ]);
});

test('acceptTerms records this build\'s terms version, which fetchProfile then returns', async () => {
  const { client } = await signedInUser('profile-terms-version');

  expect((await acceptTerms('pt', client)).ok).toBe(true);

  expect(await fetchProfile(client)).toMatchObject({ ok: true, value: { termsVersion: '2026-12-01' } });
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
  const { error: versionError } = await a.client.from('profiles').update({ terms_version: '2026-12-01' }).eq('user_id', a.id);
  expect(versionError).not.toBeNull();
  const { error: eventError } = await a.client
    .from('consent_events')
    .insert({ user_id: a.id, kind: 'terms', version: '2026-12-01', locale: 'en', granted: true });
  expect(eventError).not.toBeNull();

  const { data: others } = await a.client.from('profiles').update({ theme: 'dim' }).eq('user_id', b.id).select();
  expect(others).toEqual([]);
  expect(await fetchProfile(b.client)).toMatchObject({ ok: true, value: { theme: 'system' } });
});

test("a signed-out client gets no profile and the cache keeps each user's own", async () => {
  const a = await signedInUser('profile-cache-a');
  const b = await signedInUser('profile-cache-b');
  await updateProfile({ theme: 'dim' }, a.client);
  // The repository never caches; the app's provider does, so write what each user's read returned.
  for (const user of [a, b]) {
    const read = await fetchProfile(user.client);
    if (read.ok) writeCachedProfile(user.id, read.value);
  }

  expect((await fetchProfile(anonClient())).ok).toBe(false);

  expect(readCachedProfileSync(a.id)).toMatchObject({ theme: 'dim' });
  expect(readCachedProfileSync(b.id)).toMatchObject({ theme: 'system' });
});
