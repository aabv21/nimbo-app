import { act, renderHook } from '@testing-library/react-native';
import * as Speech from 'expo-speech';
import { VoiceQuality } from 'expo-speech';
import type { Voice } from 'expo-speech';

import { pickVoice, setMicListening, stopSpeaking, useSpeaker } from '../speech';

jest.mock('expo-router', () => ({ useIsFocused: () => true }));

function voice(identifier: string, language: string, quality: VoiceQuality = VoiceQuality.Default): Voice {
  return { identifier, name: identifier, language, quality };
}

beforeEach(() => {
  jest.clearAllMocks();
  setMicListening(false);
  stopSpeaking();
});

describe('pickVoice', () => {
  test('Portuguese prefers a Brazilian voice over Portugal, Android-style tags included', () => {
    expect(pickVoice([voice('pt-pt', 'pt-PT'), voice('pt-br', 'pt_BR'), voice('en', 'en-US')], 'pt')?.identifier).toBe('pt-br');
  });

  test('Spanish prefers Latin American voices, Mexico first', () => {
    expect(pickVoice([voice('es-es', 'es-ES'), voice('es-us', 'es-US'), voice('es-mx', 'es_MX')], 'es')?.identifier).toBe('es-mx');
  });

  test('any voice in the language when the preferred region is missing, an enhanced one first', () => {
    expect(pickVoice([voice('pt-pt', 'pt-PT'), voice('en', 'en-GB')], 'pt')?.identifier).toBe('pt-pt');
    expect(pickVoice([voice('plain', 'en-US'), voice('rich', 'en-US', VoiceQuality.Enhanced)], 'en')?.identifier).toBe('rich');
  });

  test('no voice in the language gives null', () => {
    expect(pickVoice([voice('en', 'en-US')], 'pt')).toBeNull();
    expect(pickVoice([], 'en')).toBeNull();
  });
});

async function settleVoices(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test('autoPlay reads the text once the voices are known', async () => {
  await renderHook(() => useSpeaker('Noted. Rest in the dark.', { autoPlay: true }));
  await settleVoices();
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(Speech.speak).toHaveBeenCalledWith('Noted. Rest in the dark.', expect.objectContaining({ voice: 'voice-en-us' }));
});

test('autoPlay does not speak while the mic listens', async () => {
  setMicListening(true);
  await renderHook(() => useSpeaker('Noted.', { autoPlay: true }));
  await settleVoices();
  expect(Speech.speak).not.toHaveBeenCalled();
});

test('toggle speaks, and a second toggle stops', async () => {
  const hook = await renderHook(() => useSpeaker('Noted.'));
  await settleVoices();
  await act(() => {
    hook.result.current.toggle();
  });
  expect(Speech.speak).toHaveBeenCalledTimes(1);
  expect(hook.result.current.speaking).toBe(true);
  await act(() => {
    hook.result.current.toggle();
  });
  expect(Speech.stop).toHaveBeenCalled();
  expect(hook.result.current.speaking).toBe(false);
});
