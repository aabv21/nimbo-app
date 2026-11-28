// An inline error that both screen readers speak when it appears: a live region on Android, an announcement on iOS.
import { Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { useAnnouncement } from './useAnnouncement';

export function AlertText({ text, style }: { text: string; style?: StyleProp<TextStyle> }): React.JSX.Element {
  useAnnouncement(text);
  return (
    <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={style}>
      {text}
    </Text>
  );
}
