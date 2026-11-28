// The phone's account client against the local stack: the export arrives as a version 1 document, and after a deletion
// Auth answers `user_not_found` to the old token, which is what `verifyAccount` and a 401 retry count as deleted.
// Needs `pnpm db:start` and `pnpm env:local`.

import { deleteAccount, exportData, verifyAccount } from '../src/account/accountClient';
import { signInWithEmail } from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
let userId = '';

afterAll(async () => {
  // Already gone when the deletion test passed; a no-op then.
  if (userId !== '') await deleteUser(userId).catch(() => undefined);
});

test('export, then delete: the account exists, the export is version 1, and after the deletion it is gone, retry included', async () => {
  const email = uniqueEmail('account-client');
  userId = await createUser(email, PASSWORD);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });

  expect(await verifyAccount(userId, client)).toBe('exists');
  const exported = await exportData(client);
  expect(exported.ok).toBe(true);
  if (exported.ok) {
    const document = JSON.parse(exported.json) as { schemaVersion: unknown; account: { email: unknown } };
    expect(document.schemaVersion).toBe(1);
    expect(document.account.email).toBe(email);
  }

  expect(await deleteAccount(client)).toEqual({ ok: true });

  expect(await verifyAccount(userId, client)).toBe('gone');
  // A retry after a lost answer, with the same token, still counts as deleted.
  expect(await deleteAccount(client)).toEqual({ ok: true });
});
