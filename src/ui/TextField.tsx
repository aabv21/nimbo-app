import { TriangleAlert } from 'lucide-react-native';
import { useId, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';

import { controlHeight, fonts, radius, space, type } from './theme';
import { useTheme } from './themeContext';

type PassThrough = Omit<
  TextInputProps,
  'style' | 'value' | 'onChangeText' | 'placeholderTextColor' | 'keyboardAppearance' | 'accessibilityLabel'
>;

interface TextFieldProps extends PassThrough {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Guidance under the field, read with it by a screen reader. */
  help?: string;
  /** Replaces the help line and marks the field invalid. */
  error?: string;
}

export function TextField({ label, value, onChangeText, help, error, onFocus, onBlur, ...input }: TextFieldProps): React.JSX.Element {
  const { name, color } = useTheme();
  const [focused, setFocused] = useState(false);
  const labelId = useId();
  const invalid = error !== undefined;
  const note = error ?? help;

  return (
    <View style={styles.field}>
      <Text nativeID={labelId} style={[styles.label, { color: color.text }]}>
        {label}
      </Text>
      <TextInput
        {...input}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        accessibilityLabelledBy={labelId}
        {...(note === undefined ? {} : { accessibilityHint: note })}
        aria-invalid={invalid}
        // A light keyboard would be the brightest thing on a Dark or Dim screen.
        keyboardAppearance={name === 'day' ? 'light' : 'dark'}
        placeholderTextColor={color.textMuted}
        selectionColor={color.accentText}
        cursorColor={color.accentText}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          styles.input,
          { backgroundColor: color.surface, color: color.text, borderColor: color.textMuted },
          focused && { borderColor: color.accentText, outlineColor: color.accentText, outlineStyle: 'solid', outlineWidth: 2, outlineOffset: 1 },
          invalid && { borderColor: color.danger, borderWidth: 2 },
        ]}
      />
      {invalid ? (
        <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <TriangleAlert size={20} color={color.danger} />
          <Text style={[styles.caption, styles.errorText, { color: color.danger }]}>{error}</Text>
        </View>
      ) : help === undefined ? null : (
        <Text style={[styles.caption, { color: color.textMuted }]}>{help}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  input: {
    minHeight: controlHeight,
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
    fontFamily: fonts.body,
    fontSize: type.body,
    lineHeight: 24,
  },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: space[1] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  errorText: { flexShrink: 1, fontFamily: fonts.bodySemiBold },
});
