import { act, renderHook } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { emitRecognition, hear, recognition, settle } from '../../test/dictation';
import { recognitionLanguage, useDictation } from '../dictation';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('recognitionLanguage', () => {
  test("the device's own regional variant of the app language comes first", () => {
    expect(recognitionLanguage('pt', ['pt-BR'])).toBe('pt-BR');
    expect(recognitionLanguage('es', ['es-CO'])).toBe('es-CO');
    expect(recognitionLanguage('en', ['es-CO', 'en-GB'])).toBe('en-GB');
  });

  test('otherwise US English, Mexican Spanish or Brazilian Portuguese', () => {
    expect(recognitionLanguage('pt', ['en-US'])).toBe('pt-BR');
    expect(recognitionLanguage('es', ['es'])).toBe('es-MX');
    expect(recognitionLanguage('en', ['pt-BR'])).toBe('en-US');
  });
});

/** A mounted hook whose press has started the recognizer. */
async function listening(onHeard: (text: string) => void = jest.fn()) {
  const hook = await renderHook(() => useDictation(onHeard));
  await act(() => {
    hook.result.current.start();
  });
  await settle();
  return hook;
}

test('start runs on the device on iOS, in the app language, and holds until released', async () => {
  const hook = await listening();
  expect(recognition.start).toHaveBeenCalledWith(
    expect.objectContaining({ lang: 'en-US', requiresOnDeviceRecognition: true, continuous: true, interimResults: false }),
  );
  expect(hook.result.current.listening).toBe(true);

  await act(() => {
    hook.result.current.finish();
  });
  expect(recognition.stop).toHaveBeenCalledTimes(1);
});

test('release delivers what was heard, segments joined, once the session ends', async () => {
  const onHeard = jest.fn();
  const hook = await listening(onHeard);
  await act(() => {
    emitRecognition('result', { isFinal: true, results: [{ transcript: 'me tomé un ibuprofeno', confidence: 0.9, segments: [] }] });
    emitRecognition('result', { isFinal: true, results: [{ transcript: 'hace diez minutos', confidence: 0.9, segments: [] }] });
  });
  expect(onHeard).not.toHaveBeenCalled();
  await act(() => {
    hook.result.current.finish();
    emitRecognition('end');
  });
  expect(onHeard).toHaveBeenCalledWith('me tomé un ibuprofeno hace diez minutos');
  expect(hook.result.current.listening).toBe(false);
  expect(hook.result.current.problem).toBeNull();
});

test('cancel aborts and never calls onHeard, even if a result arrives late', async () => {
  const onHeard = jest.fn();
  const hook = await listening(onHeard);
  await act(() => {
    hook.result.current.cancel();
  });
  expect(recognition.abort).toHaveBeenCalledTimes(1);
  await act(() => {
    emitRecognition('error', { error: 'aborted', message: '' });
    hear('did not mean it');
  });
  expect(onHeard).not.toHaveBeenCalled();
  expect(hook.result.current.problem).toBeNull();
  expect(hook.result.current.listening).toBe(false);
});

test('a session with no result sets noMatch', async () => {
  const onHeard = jest.fn();
  const hook = await listening(onHeard);
  await act(() => {
    emitRecognition('end');
  });
  expect(onHeard).not.toHaveBeenCalled();
  expect(hook.result.current.problem).toBe('noMatch');
  await act(() => {
    hook.result.current.clearProblem();
  });
  expect(hook.result.current.problem).toBeNull();
});

test('a refused permission sets denied and never starts', async () => {
  recognition.requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' });
  const hook = await listening();
  expect(recognition.start).not.toHaveBeenCalled();
  expect(hook.result.current.problem).toBe('denied');
});

test('a recognizer error sets failed', async () => {
  const hook = await listening();
  await act(() => {
    emitRecognition('error', { error: 'network', message: '' });
    emitRecognition('end');
  });
  expect(hook.result.current.problem).toBe('failed');
});

test('a tap released before the recognizer started never starts it and asks to hold', async () => {
  const hook = await renderHook(() => useDictation(jest.fn()));
  await act(() => {
    hook.result.current.start();
    hook.result.current.finish();
  });
  await settle();
  expect(recognition.start).not.toHaveBeenCalled();
  expect(hook.result.current.problem).toBe('noMatch');
});

test('a press cancelled before the recognizer started (the permission prompt took the touch) starts nothing and says nothing', async () => {
  const hook = await renderHook(() => useDictation(jest.fn()));
  await act(() => {
    hook.result.current.start();
    hook.result.current.cancel();
  });
  await settle();
  expect(recognition.start).not.toHaveBeenCalled();
  expect(hook.result.current.problem).toBeNull();
});

describe('on Android', () => {
  const os = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  });

  test('the default recognizer, offline when the language pack is installed', async () => {
    recognition.getSupportedLocales.mockResolvedValueOnce({ locales: ['en-US'], installedLocales: ['en-US'] });
    await listening();
    expect(recognition.start).toHaveBeenLastCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: true }));
  });

  test('online when it is not, or when the check fails', async () => {
    const hook = await listening();
    expect(recognition.start).toHaveBeenLastCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: false }));
    await act(() => {
      hook.result.current.cancel();
      emitRecognition('end');
    });

    recognition.getSupportedLocales.mockRejectedValueOnce(new Error('no service'));
    await listening();
    expect(recognition.start).toHaveBeenLastCalledWith(expect.objectContaining({ requiresOnDeviceRecognition: false }));
  });
});
