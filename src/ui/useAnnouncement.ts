// VoiceOver has no live regions: a message that appears after a press is spoken here; TalkBack reads the live region.
import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Speaks `message` on iOS when it appears or changes; null says nothing. */
export function useAnnouncement(message: string | null): void {
  useEffect(() => {
    if (message !== null && message !== '' && Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
