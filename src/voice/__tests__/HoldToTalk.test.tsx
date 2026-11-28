import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { hear, recognition, settle } from '../../test/dictation';
import { HoldToTalk } from '../HoldToTalk';

beforeEach(() => {
  jest.clearAllMocks();
});

async function mount(props: Partial<Parameters<typeof HoldToTalk>[0]> = {}): Promise<jest.Mock> {
  const onHeard = jest.fn();
  await render(<HoldToTalk label="Tell me" hint="Hold and speak" onHeard={onHeard} size="crisis" {...props} />);
  return onHeard;
}

const button = (): ReturnType<typeof screen.getByRole> => screen.getByRole('button', { name: 'Tell me' });

async function pressIn(pageY = 600): Promise<void> {
  await fireEvent(button(), 'responderGrant', { nativeEvent: { pageY } });
  await settle();
}

test('press in starts listening, and release finishes with what was heard', async () => {
  const onHeard = await mount();
  await pressIn();
  expect(recognition.start).toHaveBeenCalledTimes(1);

  await fireEvent(screen.getByRole('button'), 'responderRelease', { nativeEvent: { pageY: 600 } });
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  await act(() => {
    hear('a dark room helped');
  });
  expect(onHeard).toHaveBeenCalledWith('a dark room helped');
});

test('a small drift while held still finishes', async () => {
  await mount();
  await pressIn();
  await fireEvent(screen.getByRole('button'), 'responderMove', { nativeEvent: { pageY: 570 } });
  await fireEvent(screen.getByRole('button'), 'responderRelease', { nativeEvent: { pageY: 570 } });
  expect(recognition.stop).toHaveBeenCalledTimes(1);
  expect(recognition.abort).not.toHaveBeenCalled();
});

test('a move up of 60 pt, then release, cancels', async () => {
  const onHeard = await mount();
  await pressIn();
  await fireEvent(screen.getByRole('button'), 'responderMove', { nativeEvent: { pageY: 540 } });
  await fireEvent(screen.getByRole('button'), 'responderRelease', { nativeEvent: { pageY: 540 } });
  expect(recognition.abort).toHaveBeenCalledTimes(1);
  expect(recognition.stop).not.toHaveBeenCalled();
  await act(() => {
    hear('never meant');
  });
  expect(onHeard).not.toHaveBeenCalled();
});

test('while held, the crisis button says it is listening and how to cancel', async () => {
  await mount();
  await pressIn();
  expect(screen.getByRole('button', { name: 'Listening, let go to finish' })).toBeOnTheScreen();
  expect(screen.getByText('Slide up to cancel')).toBeOnTheScreen();
});

test('the accessibility hint is the hint prop', async () => {
  await mount();
  expect(button()).toHaveProp('accessibilityHint', 'Hold and speak');
});

test('disabled, a press starts nothing', async () => {
  await mount({ disabled: true });
  await pressIn();
  expect(recognition.start).not.toHaveBeenCalled();
  expect(button()).toBeDisabled();
});

test('a screen reader activates it once to start and once to finish', async () => {
  await mount();
  await fireEvent(button(), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  await settle();
  expect(recognition.start).toHaveBeenCalledTimes(1);
  await fireEvent(screen.getByRole('button'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
  expect(recognition.stop).toHaveBeenCalledTimes(1);
});

test('on iOS without on-device recognition, nothing renders: the audio would leave the phone', async () => {
  recognition.supportsOnDeviceRecognition.mockReturnValueOnce(false);
  await mount();
  expect(screen.queryByRole('button')).toBeNull();
});

test('no recognizer on the phone: nothing renders', async () => {
  recognition.isRecognitionAvailable.mockReturnValueOnce(false);
  await mount();
  expect(screen.queryByRole('button')).toBeNull();
});
