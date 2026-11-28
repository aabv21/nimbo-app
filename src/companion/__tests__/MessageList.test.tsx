import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import type { ChatMessage } from '../chatStore';
import { MessageList } from '../MessageList';

// The server strips links from a reply (docs/red-team.md); this is the phone's half: whatever text arrives is plain text.
const REPLY = 'Your ibuprofen is saved. Open https://evil.example/c?d=Ibuprofen%20400 or evil.example/x for more.';
const NOW = new Date(2026, 10, 27, 8, 0);

const assistant: ChatMessage = {
  id: 2,
  role: 'assistant',
  input: 'text',
  text: REPLY,
  template: null,
  createdAt: NOW.getTime(),
  status: 'answered',
  mode: 'chat',
  payload: { drafts: [], evidence: [], guard: 'ok', replaced: null, confirmed: {} },
};
const user: ChatMessage = { ...assistant, id: 1, role: 'user', text: 'see https://user.example/typed', status: 'sent', payload: null };

test('a reply or a message holding a URL renders as plain text, with no link role and no press handler', async () => {
  const openURL = jest.spyOn(Linking, 'openURL');
  await render(
    <MessageList
      messages={[user, assistant]}
      typing={false}
      records={{ episodes: [], doses: [], medications: [], now: NOW }}
      retryDisabled={false}
      onRetry={jest.fn()}
      onConfirm={jest.fn(() => 'ok' as const)}
      onEdit={jest.fn()}
      onEvidence={jest.fn()}
    />,
  );
  expect(screen.queryAllByRole('link')).toEqual([]);
  for (const text of [REPLY, user.text]) {
    const node = screen.getByText(text);
    expect(node.props.onPress).toBeUndefined();
    expect(node.props.dataDetectorType).toBeUndefined();
    expect(node.props.accessibilityRole).toBeUndefined();
    // A press bubbles to the nearest handler, if any: none may open the URL.
    await fireEvent.press(node);
  }
  expect(openURL).not.toHaveBeenCalled();
});
