import { act, renderHook } from '@testing-library/react-native';

import type { RequestResult } from '../../lib/requestResult';
import { READY_PROFILE, currentAuth, resetAuth } from '../../test/authMock';
import { updateProfile } from '../profileRepository';
import type { Profile } from '../profileRepository';
import { useProfileChange } from '../useProfileChange';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../profileRepository', () => ({ updateProfile: jest.fn() }));

const mockedUpdate = jest.mocked(updateProfile);
type Answer = (value: RequestResult<Profile>) => void;

/** Each call to `updateProfile` waits until the test answers it. */
function holdWrites(): Answer[] {
  const answers: Answer[] = [];
  mockedUpdate.mockImplementation(
    () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
  );
  return answers;
}

async function answer(reply: Answer | undefined, value: RequestResult<Profile>): Promise<void> {
  await act(async () => {
    reply?.(value);
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockedUpdate.mockReset();
  resetAuth();
});

test('an older write answering after a newer one to the same field leaves the newer value', async () => {
  const answers = holdWrites();
  const { result } = await renderHook(() => useProfileChange());

  await act(() => {
    void result.current.change({ theme: 'dark' });
  });
  await act(() => {
    void result.current.change({ theme: 'dim' });
  });
  await answer(answers[1], { ok: true, value: { ...READY_PROFILE, theme: 'dim' } });
  await answer(answers[0], { ok: true, value: { ...READY_PROFILE, theme: 'dark' } });

  expect(currentAuth().profile?.theme).toBe('dim');
});

test('an older write answering late does not undo a newer change to another field', async () => {
  const answers = holdWrites();
  const { result } = await renderHook(() => useProfileChange());

  await act(() => {
    void result.current.change({ theme: 'dark' });
  });
  await act(() => {
    void result.current.change({ reduceMotion: true });
  });
  await answer(answers[1], { ok: true, value: { ...READY_PROFILE, theme: 'dark', reduceMotion: true } });
  // The first write's row predates the second.
  await answer(answers[0], { ok: true, value: { ...READY_PROFILE, theme: 'dark', reduceMotion: false } });

  expect(currentAuth().profile).toMatchObject({ theme: 'dark', reduceMotion: true });
});

test('an older write failing after a newer one does not put the field back', async () => {
  const answers = holdWrites();
  const { result } = await renderHook(() => useProfileChange());

  await act(() => {
    void result.current.change({ theme: 'dark' });
  });
  await act(() => {
    void result.current.change({ theme: 'dim' });
  });
  await answer(answers[1], { ok: true, value: { ...READY_PROFILE, theme: 'dim' } });
  await answer(answers[0], { ok: false, kind: 'network' });

  expect(currentAuth().profile?.theme).toBe('dim');
  expect(result.current.error).toBeUndefined();
});

test('a failed write puts the previous value back and keeps the kind', async () => {
  const answers = holdWrites();
  const { result } = await renderHook(() => useProfileChange());

  await act(() => {
    void result.current.change({ theme: 'dark' });
  });
  expect(currentAuth().profile?.theme).toBe('dark');
  await answer(answers[0], { ok: false, kind: 'network' });

  expect(currentAuth().profile?.theme).toBe('day');
  expect(result.current.error).toBe('network');
});
