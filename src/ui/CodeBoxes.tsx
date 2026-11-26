import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputInstance } from 'react-native';

import { controlHeight, fonts, radius, space, type } from './theme';
import { useTheme } from './themeContext';

interface CodeBoxesProps {
  label: string;
  value: string;
  length: number;
  onChangeText: (text: string) => void;
}

/**
 * Six cells drawn over one real input, so one-time-code autofill and screen readers keep working: the
 * input carries the label and the digits, the cells are decoration that mirror it.
 */
export function CodeBoxes({ label, value, length, onChangeText }: CodeBoxesProps): React.JSX.Element {
  const { name, color } = useTheme();
  const input = useRef<TextInputInstance>(null);
  const [focused, setFocused] = useState(false);
  const current = Math.min(value.length, length - 1);

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      <Pressable
        accessible={false}
        onPress={() => {
          input.current?.focus();
        }}
        style={styles.row}
      >
        <View style={styles.cells} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length }, (_, index) => (
            <View
              key={index}
              testID="code-cell"
              style={[
                styles.cell,
                { backgroundColor: color.surface, borderColor: focused && index === current ? color.accentText : color.textMuted },
                focused && index === current && styles.cellFocused,
              ]}
            >
              <Text style={[styles.digit, { color: color.text }]}>{value.charAt(index)}</Text>
            </View>
          ))}
        </View>
        <TextInput
          ref={input}
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={label}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={length}
          caretHidden
          keyboardAppearance={name === 'day' ? 'light' : 'dark'}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
          }}
          style={styles.hidden}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  label: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  row: { flexDirection: 'row', gap: space[1] },
  // Without its own width the inner row shrinks to its content and the flex cells collapse to nothing.
  cells: { flex: 1, flexDirection: 'row', gap: space[1] },
  cell: {
    flex: 1,
    minHeight: controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
  },
  cellFocused: { borderWidth: 2 },
  digit: { fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27 },
  // Transparent and stretched over the cells so a tap lands on it; it still holds focus and the value.
  hidden: { ...StyleSheet.absoluteFill, opacity: 0.02, color: 'transparent' },
});
