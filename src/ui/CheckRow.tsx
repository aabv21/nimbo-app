import { Check } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { controlHeight, fonts, space, type } from './theme';
import { useTheme } from './themeContext';

interface CheckRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A stable English id for the Maestro flows; never copy. */
  testID?: string;
}

/** A labelled checkbox; the whole row is the 48 pt target. */
export function CheckRow({ label, checked, onChange, testID }: CheckRowProps): React.JSX.Element {
  const { color } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => {
        onChange(!checked);
      }}
      style={styles.row}
    >
      <View style={[styles.box, { borderColor: checked ? color.accent : color.textMuted, backgroundColor: checked ? color.accent : 'transparent' }]}>
        {checked ? <Check size={18} color={color.onAccent} /> : null}
      </View>
      <Text style={[styles.label, { color: color.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: controlHeight },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
});
