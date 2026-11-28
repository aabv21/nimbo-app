import { render, screen } from '@testing-library/react-native';

import { translate } from '../../i18n';
import { CompanionNoteCard } from '../CompanionNoteCard';

// 13:05 UTC: 08:05 in Bogotá, 22:05 in Tokyo, whatever zone the machine running the test is in.
const NOW = new Date('2026-11-27T13:05:00Z');

test.each([
  ['America/Bogota', 'today.note.by_morning'],
  ['Asia/Tokyo', 'today.note.by_now'],
] as const)('the note header follows the hour in the rows’ zone (%s), not the device’s', async (timeZone, key) => {
  await render(<CompanionNoteCard state={{ kind: 'first' }} now={NOW} timeZone={timeZone} onReply={null} />);
  expect(screen.getByText(translate('en', key))).toBeOnTheScreen();
});
