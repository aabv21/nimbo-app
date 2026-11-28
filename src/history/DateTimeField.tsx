// A date-time field: iOS shows the native picker inline under it; Android asks for the date, then the time.
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { stamp } from './dateLabels';

interface DateTimeFieldProps {
  label: string;
  /** Null shows `empty` until a time is chosen. */
  value: Date | null;
  empty: string;
  onChange: (value: Date) => void;
  invalid?: boolean;
}

export function DateTimeField({ label, value, empty, onChange, invalid = false }: DateTimeFieldProps): React.JSX.Element {
  const { locale } = useI18n();
  const { name, color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const [open, setOpen] = useState(false);
  const shown = value === null ? empty : stamp(value, locale);

  const press = (): void => {
    if (Platform.OS !== 'android') {
      setOpen((current) => !current);
      return;
    }
    const start = value ?? new Date();
    DateTimePickerAndroid.open({
      mode: 'date',
      value: start,
      maximumDate: new Date(),
      onValueChange: (_event, date) => {
        DateTimePickerAndroid.open({
          mode: 'time',
          value: date,
          is24Hour: locale !== 'en',
          onValueChange: (_timeEvent, picked) => {
            onChange(picked);
          },
        });
      },
    });
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
      <Animated.View style={scaleStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${shown}`}
          accessibilityState={{ expanded: open }}
          onPress={press}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          style={[styles.input, { borderColor: invalid ? color.danger : color.border, backgroundColor: color.surface }]}
        >
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
          <Text style={[styles.value, { color: value === null ? color.textMuted : color.text }]}>{shown}</Text>
        </Pressable>
      </Animated.View>
      {open && Platform.OS !== 'android' ? (
        <DateTimePicker
          mode="datetime"
          display="inline"
          value={value ?? new Date()}
          maximumDate={new Date()}
          locale={locale}
          themeVariant={name === 'day' ? 'light' : 'dark'}
          accentColor={color.accent}
          onValueChange={(_event, date) => {
            onChange(date);
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: space[1] },
  label: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  input: {
    minHeight: controlHeight,
    justifyContent: 'center',
    paddingHorizontal: space[2],
    borderWidth: 1,
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  value: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
