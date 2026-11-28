// authService against the running local stack (docs/testing.md#integration); every test uses a unique email.

import {
  confirmPasswordReset,
  confirmSignUp,
  requestPasswordReset,
  resendSignUpCode,
  signInWithEmail,
  signOut,
  signUpWithEmail,
} from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, deleteUserByEmail, latestEmailCode, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const createdUserIds: string[] = [];

afterAll(async () => {
  await Promise.all(createdUserIds.map((id) => deleteUser(id)));
});

async function rememberSignedInUser(client: ReturnType<typeof anonClient>): Promise<void> {
  const { data } = await client.auth.getUser();
  if (data.user !== null) {
    createdUserIds.push(data.user.id);
  }
}

describe('sign-up with the emailed code', () => {
  test('sign in before confirming is its own error, then the code confirms and sign-in works', async () => {
    const email = uniqueEmail('signup-flow');
    const password = 'Password123!';
    const client = anonClient();

    // Confirmations are on locally, so sign-up returns no session.
    expect(await signUpWithEmail(email, password, client)).toEqual({ ok: true, needsConfirmation: true });
    const { data: pending } = await client.auth.getSession();
    expect(pending.session).toBeNull();

    expect(await signInWithEmail(email, password, anonClient())).toEqual({
      ok: false,
      error: 'auth.error.emailNotConfirmed',
    });

    const code = await latestEmailCode(email);
    expect(await confirmSignUp(email, code, client)).toEqual({ ok: true });
    await rememberSignedInUser(client);
    expect(await signOut(client)).toEqual({ ok: true });

    const fresh = anonClient();
    expect(await signInWithEmail(email, password, fresh)).toEqual({ ok: true });
    const { data } = await fresh.auth.getUser();
    expect(data.user?.email).toBe(email);
  });

  test('a wrong code is invalidCode and the account stays unconfirmed', async () => {
    const email = uniqueEmail('signup-wrong-code');
    const password = 'Password123!';
    const client = anonClient();
    await signUpWithEmail(email, password, client);
    const realCode = await latestEmailCode(email);
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    expect(await confirmSignUp(email, wrongCode, client)).toEqual({ ok: false, error: 'auth.error.invalidCode' });

    expect(await signInWithEmail(email, password, anonClient())).toEqual({
      ok: false,
      error: 'auth.error.emailNotConfirmed',
    });
    await deleteUserByEmail(email);
  });

  test('a resent code confirms the account', async () => {
    const email = uniqueEmail('signup-resend');
    const client = anonClient();
    await signUpWithEmail(email, 'Password123!', client);

    // Auth allows one email per address per second (`max_frequency`).
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(await resendSignUpCode(email, client)).toEqual({ ok: true });
    const code = await latestEmailCode(email);

    expect(await confirmSignUp(email, code, client)).toEqual({ ok: true });
    await rememberSignedInUser(client);
  });

  test('the server rejects a password shorter than the app minimum of 8 as weak', async () => {
    const result = await signUpWithEmail(uniqueEmail('short-password'), 'Pass12!', anonClient());

    expect(result).toEqual({ ok: false, error: 'auth.error.weakPassword' });
  });
});

test('a wrong password gives invalidCredentials', async () => {
  const email = uniqueEmail('wrong-password');
  createdUserIds.push(await createUser(email, 'Password123!'));

  const result = await signInWithEmail(email, 'TotallyWrongPassword!', anonClient());

  expect(result).toEqual({ ok: false, error: 'auth.error.invalidCredentials' });
});

test('sign in, sign out, then sign in again', async () => {
  const email = uniqueEmail('sign-in-out');
  createdUserIds.push(await createUser(email, 'Password123!'));
  const client = anonClient();

  expect(await signInWithEmail(email, 'Password123!', client)).toEqual({ ok: true });
  expect(await signOut(client)).toEqual({ ok: true });
  const { data } = await client.auth.getSession();
  expect(data.session).toBeNull();
  expect(await signInWithEmail(email, 'Password123!', client)).toEqual({ ok: true });
});

describe('password reset', () => {
  test('request -> code -> confirm with a new password; old password stops working', async () => {
    const email = uniqueEmail('reset-flow');
    createdUserIds.push(await createUser(email, 'OldPassword123!'));

    expect(await requestPasswordReset(email, anonClient())).toEqual({ ok: true });
    const code = await latestEmailCode(email);

    expect(await confirmPasswordReset(email, code, 'NewPassword456!', anonClient())).toEqual({ ok: true });
    expect(await signInWithEmail(email, 'NewPassword456!', anonClient())).toEqual({ ok: true });
    expect(await signInWithEmail(email, 'OldPassword123!', anonClient())).toEqual({
      ok: false,
      error: 'auth.error.invalidCredentials',
    });
  });

  test('a wrong code gives invalidCode and leaves the password unchanged', async () => {
    const email = uniqueEmail('reset-wrong-code');
    createdUserIds.push(await createUser(email, 'OriginalPassword1!'));

    await requestPasswordReset(email, anonClient());
    const realCode = await latestEmailCode(email);
    const wrongCode = realCode === '000000' ? '111111' : '000000';

    expect(await confirmPasswordReset(email, wrongCode, 'ShouldNotApply1!', anonClient())).toEqual({
      ok: false,
      error: 'auth.error.invalidCode',
    });
    expect(await signInWithEmail(email, 'OriginalPassword1!', anonClient())).toEqual({ ok: true });
  });

  test('reusing a used code gives invalidCode and keeps the first new password', async () => {
    const email = uniqueEmail('reset-reuse-code');
    createdUserIds.push(await createUser(email, 'FirstPassword1!'));

    await requestPasswordReset(email, anonClient());
    const code = await latestEmailCode(email);

    expect(await confirmPasswordReset(email, code, 'SecondPassword2!', anonClient())).toEqual({ ok: true });
    expect(await confirmPasswordReset(email, code, 'ThirdPassword3!', anonClient())).toEqual({
      ok: false,
      error: 'auth.error.invalidCode',
    });
    expect(await signInWithEmail(email, 'SecondPassword2!', anonClient())).toEqual({ ok: true });
  });
});
