// The message field, which grows with its text up to a few lines, the mic you hold to dictate into it, and Send.
import { ArrowUp } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { matchRedFlagsAnyLocale, packs } from '../condition';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { dictationAvailable, PROBLEM_KEY } from '../voice/dictation';
import type { DictationProblem } from '../voice/dictation';
import { HoldToTalk } from '../voice/HoldToTalk';
import { TURN_MAX_CHARS } from './contract';

/** About five lines; past that the field scrolls inside itself. */
const MAX_INPUT_HEIGHT = 128;

interface ComposerProps {
  /** Offline, unavailable or over the quota: nothing can be sent. */
  disabled: boolean;
  placeholder: MessageKey;
  /** A message is on its way; the field stays editable but a second send waits. */
  busy: boolean;
  /** Dictation is used up today: only the mic is off, and typing still works. */
  dictationOver: boolean;
  /** `voice` when the text holds a transcript, so the send spends a dictation unit too. */
  onSend: (text: string, input: 'text' | 'voice') => void;
}

export function Composer({ disabled, placeholder, busy, dictationOver, onSend }: ComposerProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const [text, setText] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [problem, setProblem] = useState<DictationProblem | null>(null);
  const [micShown] = useState(dictationAvailable);
  const canSend = !disabled && !busy && text.trim() !== '';

  const send = (): void => {
    if (!canSend) return;
    onSend(text, spoken ? 'voice' : 'text');
    setText('');
    setSpoken(false);
  };
  // A transcript waits in the field for Send, except a red flag: that goes at once, so urgent care opens now and the
  // send stores it as one, with nothing sent to the companion.
  const heard = (transcript: string): void => {
    if (matchRedFlagsAnyLocale(transcript, packs.migraine).length > 0) {
      onSend(transcript, 'voice');
      return;
    }
    setText((current) => (current.trim() === '' ? transcript : `${current.trimEnd()} ${transcript}`).slice(0, TURN_MAX_CHARS));
    setSpoken(true);
  };

  return (
    <View style={styles.column}>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={[styles.caption, { color: color.textMuted }]}>
          {t(PROBLEM_KEY[problem])}
        </Text>
      )}
      <View style={styles.row}>
        <TextInput
          accessibilityLabel={t('companion.input.label')}
          value={text}
          onChangeText={(next) => {
            setText(next);
            // Cleared by hand: what is typed next is typing.
            if (next.trim() === '') setSpoken(false);
          }}
          editable={!disabled}
          multiline
          maxLength={TURN_MAX_CHARS}
          placeholder={t(placeholder)}
          placeholderTextColor={color.textMuted}
          style={[
            styles.input,
            { color: color.text, borderColor: color.border, backgroundColor: disabled ? tones.disabledFill : color.surface },
          ]}
        />
        <HoldToTalk
          label={t('companion.mic')}
          hint={t(dictationOver ? 'voice.quota' : 'crisis.tell.hint')}
          size="regular"
          disabled={disabled || dictationOver}
          onHeard={heard}
          onProblem={setProblem}
        />
        <Animated.View style={scaleStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('companion.send')}
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={send}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            style={[styles.send, { backgroundColor: canSend ? color.accent : tones.disabledFill }]}
          >
            <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressAccent }, pressedStyle]} />
            <ArrowUp size={24} color={canSend ? color.onAccent : color.textMuted} />
          </Pressable>
        </Animated.View>
      </View>
      {/* Why the mic is grey, in words, not only in its screen-reader hint. */}
      {dictationOver && micShown ? <Text style={[styles.caption, styles.quota, { color: color.textMuted }]}>{t('voice.quota')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: space[1] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  quota: { textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space[1] },
  input: {
    flex: 1,
    minHeight: controlHeight,
    maxHeight: MAX_INPUT_HEIGHT,
    paddingHorizontal: space[2],
    paddingTop: space[2],
    paddingBottom: space[2],
    borderRadius: radius.control,
    borderWidth: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 22,
  },
  send: { width: controlHeight, height: controlHeight, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
});
