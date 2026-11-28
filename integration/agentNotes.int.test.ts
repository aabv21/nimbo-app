// agentNotesRepository against the running local stack: each account reads only its own notes, newest first, and a
// delete forgets one of them and never another account's.

import { signInWithEmail } from '../src/auth/emailAuth';
import { deleteAgentNote, fetchAgentNotes } from '../src/memory/agentNotesRepository';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';

const users: string[] = [];

async function signedInClient(label: string): Promise<ReturnType<typeof anonClient>> {
  const email = uniqueEmail(label);
  users.push(await createUser(email, PASSWORD));
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return client;
}

/** Saved as the companion function does, through the RPC with the user's own session. */
async function saveNote(client: ReturnType<typeof anonClient>, text: string): Promise<string> {
  const { data, error } = await client.rpc('save_agent_note', { p_text: text });
  if (error !== null) throw new Error(`save_agent_note failed: ${error.code}`);
  return data;
}

afterAll(async () => {
  await Promise.all(users.map((id) => deleteUser(id)));
});

test('an account reads only its own notes, newest first, and a delete forgets one', async () => {
  const ana = await signedInClient('notes-ana');
  const ben = await signedInClient('notes-ben');
  const older = await saveNote(ana, 'Prefers short answers');
  const newer = await saveNote(ana, 'Works night shifts on Thursdays');
  const bens = await saveNote(ben, 'Phone light bothers them during attacks');

  const read = await fetchAgentNotes(ana);
  expect(read.ok && read.value.map((note) => note.id)).toEqual([newer, older]);
  expect(read.ok && read.value[0]?.text).toBe('Works night shifts on Thursdays');

  // Another account's id is a no-op, not an error, and leaves that note in place.
  expect(await deleteAgentNote(bens, ana)).toEqual({ ok: true, value: undefined });
  expect(await deleteAgentNote(older, ana)).toEqual({ ok: true, value: undefined });

  const after = await fetchAgentNotes(ana);
  expect(after.ok && after.value.map((note) => note.id)).toEqual([newer]);
  const bensRead = await fetchAgentNotes(ben);
  expect(bensRead.ok && bensRead.value.map((note) => note.id)).toEqual([bens]);
});

test('a signed-out client is refused the read and the delete', async () => {
  const anon = anonClient();

  expect(await fetchAgentNotes(anon)).toMatchObject({ ok: false });
  expect(await deleteAgentNote('00000000-0000-4000-8000-000000000001', anon)).toMatchObject({ ok: false });
});
