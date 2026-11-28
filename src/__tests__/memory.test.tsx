// "What I know about you": the agent's notes, read online, cached per user for an offline view, each deletable.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Memory from '../app/memory';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { kvRemove } from '../lib/kv';
import type { RequestResult } from '../lib/requestResult';
import { deleteAgentNote, fetchAgentNotes, readCachedNotes, writeCachedNotes } from '../memory/agentNotesRepository';
import type { AgentNote } from '../memory/agentNotesRepository';
import { resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../memory/agentNotesRepository', () => ({
  ...jest.requireActual<typeof import('../memory/agentNotesRepository')>('../memory/agentNotesRepository'),
  fetchAgentNotes: jest.fn(),
  deleteAgentNote: jest.fn(),
}));

const t = (key: MessageKey): string => translate('en', key);
const mockedFetch = jest.mocked(fetchAgentNotes);
const mockedDelete = jest.mocked(deleteAgentNote);

const NEWER: AgentNote = { id: 'n2', text: 'Works night shifts on Thursdays', createdAt: '2026-11-20T10:00:00Z' };
const OLDER: AgentNote = { id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function firstDelete(): ReturnType<typeof screen.getByRole> {
  const [first] = screen.getAllByRole('button', { name: t('memory.delete') });
  if (first === undefined) throw new Error('no delete button');
  return first;
}

function noteTexts(): string[] {
  return [NEWER.text, OLDER.text].filter((text) => screen.queryByText(text) !== null);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  kvRemove('memory.user-1');
  kvRemove('memory.user-2');
  mockedFetch.mockResolvedValue({ ok: true, value: [NEWER, OLDER] });
  mockedDelete.mockResolvedValue({ ok: true, value: undefined });
});

test('with no notes, the empty state says what will show up here', async () => {
  mockedFetch.mockResolvedValue({ ok: true, value: [] });

  await render(<Memory />);

  expect(await screen.findByText(t('memory.empty'))).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('profile.memory') })).toBeOnTheScreen();
  expect(screen.getByText(t('memory.only'))).toBeOnTheScreen();
  expect(screen.queryByText(t('memory.lede'))).toBeNull();
});

test('two notes are listed newest first, under the lede', async () => {
  await render(<Memory />);

  expect(await screen.findByText(NEWER.text)).toBeOnTheScreen();
  expect(screen.getByText(t('memory.lede'))).toBeOnTheScreen();
  const texts = screen.getAllByTestId(/^memory-note-/).map((node) => node.props.testID as string);
  expect(texts).toEqual(['memory-note-n2', 'memory-note-n1']);
  expect(screen.getAllByRole('button', { name: t('memory.delete') })).toHaveLength(2);
  // The online read is kept for an offline visit.
  expect(readCachedNotes('user-1')).toEqual([NEWER, OLDER]);
});

test('deleting a note removes it at once and forgets it', async () => {
  const answer = deferred<RequestResult<void>>();
  mockedDelete.mockReturnValue(answer.promise);
  await render(<Memory />);
  await screen.findByText(NEWER.text);

  await fireEvent.press(firstDelete());

  // Gone before the server answers.
  expect(noteTexts()).toEqual([OLDER.text]);
  expect(mockedDelete).toHaveBeenCalledWith('n2');
  await act(async () => {
    answer.resolve({ ok: true, value: undefined });
    await Promise.resolve();
  });
  expect(noteTexts()).toEqual([OLDER.text]);
  expect(screen.queryByText(t('memory.delete.error'))).toBeNull();
  await waitFor(() => {
    expect(readCachedNotes('user-1')).toEqual([OLDER]);
  });
});

test('a failed delete puts the note back in its place, with the error', async () => {
  mockedDelete.mockResolvedValue({ ok: false, kind: 'network' });
  await render(<Memory />);
  await screen.findByText(NEWER.text);

  await fireEvent.press(firstDelete());

  expect(await screen.findByText(t('memory.delete.error'))).toBeOnTheScreen();
  const texts = screen.getAllByTestId(/^memory-note-/).map((node) => node.props.testID as string);
  expect(texts).toEqual(['memory-note-n2', 'memory-note-n1']);
  expect(readCachedNotes('user-1')).toEqual([NEWER, OLDER]);
});

test('offline, the cached notes are shown with deletes disabled', async () => {
  writeCachedNotes('user-1', [NEWER, OLDER]);
  mockedFetch.mockResolvedValue({ ok: false, kind: 'network' });

  await render(<Memory />);

  expect(await screen.findByText(t('error.network'))).toBeOnTheScreen();
  expect(noteTexts()).toEqual([NEWER.text, OLDER.text]);
  const deletes = screen.getAllByRole('button', { name: t('memory.delete') });
  expect(deletes).toHaveLength(2);
  for (const button of deletes) expect(button).toBeDisabled();
  await fireEvent.press(firstDelete());
  expect(mockedDelete).not.toHaveBeenCalled();
});

test('another account never sees the cached notes of the first', async () => {
  writeCachedNotes('user-1', [NEWER, OLDER]);
  resetAuth({ userId: 'user-2' });
  mockedFetch.mockReturnValue(new Promise(() => undefined));

  await render(<Memory />);

  expect(noteTexts()).toEqual([]);
  expect(screen.getByText(t('common.loading'))).toBeOnTheScreen();
});

test('a read that answers after the account changed is not cached for either account', async () => {
  const answer = deferred<RequestResult<AgentNote[]>>();
  mockedFetch.mockReturnValue(answer.promise);
  await render(<Memory />);

  await act(async () => {
    resetAuth({ userId: null, status: 'signedOut', profile: null });
    answer.resolve({ ok: true, value: [NEWER] });
    await Promise.resolve();
  });

  expect(readCachedNotes('user-1')).toBeNull();
});
