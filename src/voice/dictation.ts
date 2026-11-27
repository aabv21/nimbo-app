// Press-and-hold dictation with expo-speech-recognition: the microphone only while held, on the device on iOS, and
// offline on Android when the language pack is installed (docs/app.md#voice-srcvoice).
import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';
import type { ExpoSpeechRecognitionErrorEvent, ExpoSpeechRecognitionResultEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { useI18n } from '../i18n';
import type { Locale, MessageKey } from '../i18n';
import { setMicListening, stopSpeaking } from './speech';

const FALLBACK: Record<Locale, string> = { en: 'en-US', es: 'es-MX', pt: 'pt-BR' };

/** The device's own regional variant of the app language (es-CO, pt-PT), else en-US, es-MX or pt-BR. */
export function recognitionLanguage(locale: Locale, deviceTags: readonly string[]): string {
  const own = deviceTags.find((tag) => {
    const [language, region] = tag.split('-');
    return language?.toLowerCase() === locale && region !== undefined;
  });
  return own ?? FALLBACK[locale];
}

export type DictationProblem = 'denied' | 'failed' | 'noMatch';

export const PROBLEM_KEY: Record<DictationProblem, MessageKey> = { denied: 'voice.denied', failed: 'voice.failed', noMatch: 'voice.no_match' };

type Session = {
  owner: symbol;
  /** Final segments so far: Android's continuous mode sends one per pause. */
  heard: string[];
  problem: DictationProblem | null;
  onHeard: (text: string) => void;
  onProblem: (problem: DictationProblem) => void;
};

// The recognizer is one per app, so one module-level session says which mic owns it. A session handed over or
// cancelled is aborted, and its own `end` still arrives later: `staleEnds` counts those, and events are ignored
// until they're through.
let active: Session | null = null;
let staleEnds = 0;
const listeners = new Set<() => void>();

function notify(): void {
  setMicListening(active !== null);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function abortActive(): void {
  if (active === null) return;
  active = null;
  staleEnds += 1;
  notify();
  ExpoSpeechRecognitionModule.abort();
}

function onResult(event: ExpoSpeechRecognitionResultEvent): void {
  if (staleEnds > 0 || active === null || !event.isFinal) return;
  const transcript = event.results[0]?.transcript.trim() ?? '';
  if (transcript !== '') active.heard.push(transcript);
}

function onError(event: ExpoSpeechRecognitionErrorEvent): void {
  if (staleEnds > 0 || active === null || event.error === 'aborted') return;
  if (event.error === 'not-allowed') active.problem = 'denied';
  else if (event.error === 'no-speech' || event.error === 'speech-timeout') active.problem = 'noMatch';
  else active.problem = 'failed';
}

/** `end` always comes last, after the results or an error: what was heard wins over a late error. */
function onEnd(): void {
  if (staleEnds > 0) {
    staleEnds -= 1;
    return;
  }
  const session = active;
  if (session === null) return;
  active = null;
  notify();
  const text = session.heard.join(' ');
  if (text !== '') session.onHeard(text);
  else session.onProblem(session.problem ?? 'noMatch');
}

// The native listeners live while any mic is mounted; with none, nothing can arrive late either.
let mounted = 0;
let subscriptions: { remove: () => void }[] = [];

function attach(): void {
  mounted += 1;
  if (mounted > 1) return;
  subscriptions = [
    ExpoSpeechRecognitionModule.addListener('result', onResult),
    ExpoSpeechRecognitionModule.addListener('error', onError),
    ExpoSpeechRecognitionModule.addListener('end', onEnd),
  ];
}

function detach(): void {
  mounted -= 1;
  if (mounted > 0) return;
  for (const subscription of subscriptions) subscription.remove();
  subscriptions = [];
  staleEnds = 0;
}

/**
 * Whether the mic can show: a recognizer, and on iOS one that runs on the device, since iOS dictation must never send
 * the audio off the phone.
 */
export function dictationAvailable(): boolean {
  try {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) return false;
    return Platform.OS !== 'ios' || ExpoSpeechRecognitionModule.supportsOnDeviceRecognition();
  } catch {
    return false;
  }
}

/** iOS always on the device; Android offline only with the language pack, else the phone's default recognizer. */
async function onDevice(lang: string): Promise<boolean> {
  if (Platform.OS === 'ios') return true;
  try {
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    return installedLocales.some((tag) => tag.toLowerCase() === lang.toLowerCase());
  } catch {
    return false;
  }
}

/** A press in flight: the permission prompt or the pack check is still out when the finger lifts or slides away. */
type Pending = { released: boolean; cancelled: boolean };

/**
 * `start` on press in, `finish` on release (what was heard goes to `onHeard`), `cancel` to drop it. A session that
 * heard nothing, or a tap too short to start, sets `problem` to `noMatch`. `available` is false with no recognizer.
 */
export function useDictation(onHeard: (text: string) => void): {
  available: boolean;
  listening: boolean;
  problem: DictationProblem | null;
  start(): void;
  finish(): void;
  cancel(): void;
  clearProblem(): void;
} {
  const { t, locale } = useI18n();
  const [owner] = useState(() => Symbol('dictation'));
  const listening = useSyncExternalStore(subscribe, () => active?.owner === owner);
  const [available] = useState(dictationAvailable);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const live = useRef(true);
  const pending = useRef<Pending | null>(null);
  const onHeardRef = useRef(onHeard);
  useEffect(() => {
    onHeardRef.current = onHeard;
  });

  useEffect(() => {
    live.current = true;
    attach();
    return () => {
      live.current = false;
      pending.current = null;
      if (active?.owner === owner) abortActive();
      detach();
    };
  }, [owner]);

  const report = useCallback(
    (next: DictationProblem) => {
      setProblem(next);
      AccessibilityInfo.announceForAccessibility(t(PROBLEM_KEY[next]));
    },
    [t],
  );

  const start = useCallback(() => {
    if (active?.owner === owner || pending.current !== null) return;
    const press: Pending = { released: false, cancelled: false };
    pending.current = press;
    setProblem(null);
    void (async () => {
      // Each await may outlive the press or the screen.
      const stillWanted = (): boolean => {
        if (!live.current || press.cancelled) return false;
        if (press.released) {
          report('noMatch');
          return false;
        }
        return true;
      };
      try {
        let granted = false;
        try {
          granted = (await ExpoSpeechRecognitionModule.requestPermissionsAsync()).granted;
        } catch {
          if (live.current && !press.cancelled) report('failed');
          return;
        }
        if (!live.current || press.cancelled) return;
        if (!granted) {
          report('denied');
          return;
        }
        if (!stillWanted()) return;
        const lang = recognitionLanguage(locale, getLocales().map((entry) => entry.languageTag));
        const offline = await onDevice(lang);
        if (!stillWanted()) return;
        // The recognizer would otherwise transcribe the app's own voice.
        stopSpeaking();
        abortActive();
        active = {
          owner,
          heard: [],
          problem: null,
          onHeard: (text) => {
            onHeardRef.current(text);
          },
          onProblem: (next) => {
            if (live.current) report(next);
          },
        };
        notify();
        AccessibilityInfo.announceForAccessibility(t('crisis.listening'));
        try {
          ExpoSpeechRecognitionModule.start({
            lang,
            interimResults: false,
            // Held, not tapped: a pause must not end it before the finger lifts.
            continuous: true,
            maxAlternatives: 1,
            requiresOnDeviceRecognition: offline,
            iosTaskHint: 'dictation',
          });
        } catch {
          active = null;
          notify();
          report('failed');
        }
      } finally {
        if (pending.current === press) pending.current = null;
      }
    })();
  }, [owner, locale, t, report]);

  const finish = useCallback(() => {
    if (active?.owner === owner) {
      // Stop still delivers what was heard so far as the final result.
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    if (pending.current !== null) pending.current.released = true;
  }, [owner]);

  const cancel = useCallback(() => {
    if (active?.owner === owner) {
      abortActive();
      return;
    }
    if (pending.current !== null) pending.current.cancelled = true;
  }, [owner]);

  const clearProblem = useCallback(() => {
    setProblem(null);
  }, []);

  return { available, listening, problem, start, finish, cancel, clearProblem };
}
