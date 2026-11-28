// The emergency call button urgent care docks, and the row the boundary screen shows during a terms re-consent.
// The number follows the phone's region through the pack's emergency table.
import { getLocales } from 'expo-localization';
import { Phone } from 'lucide-react-native';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { emergencyNumber } from '../condition';
import { isMessageKey, useI18n } from '../i18n';
import { crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';

/** The phone's region, not the app language: a Spanish speaker in Brazil needs 192. */
export function phoneRegion(): string | null {
  return getLocales()[0].regionCode ?? null;
}

export function dial(number: string): void {
  // An empty `tel:` opens the dialer with no number; a phone with no dialer has nothing better to offer.
  Linking.openURL(`tel:${number}`).catch(() => undefined);
}

interface CallButtonProps {
  label: string;
  sub: string | null;
  disabled: boolean;
  onPress: () => void;
  /** A stable English id for the Maestro flows; never copy. */
  testID: string;
}

/** The screen's one filled control: danger fill, 56 pt, full width, with the region under the number. */
export function CallButton({ label, sub, disabled, onPress, testID }: CallButtonProps): React.JSX.Element {
  const { color } = useTheme();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();

  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={sub === null ? label : `${label}, ${sub}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.call, { backgroundColor: color.danger }]}
      >
        <View pointerEvents="none" style={styles.pressLayer}>
          <Animated.View style={[styles.fill, { backgroundColor: color.onAccent }, pressedStyle]} />
        </View>
        <View style={styles.callRow}>
          <Phone size={24} color={color.onAccent} />
          <Text style={[styles.callLabel, { color: color.onAccent }]}>{label}</Text>
        </View>
        {sub === null ? null : <Text style={[styles.callSub, { color: color.onAccent }]}>{sub}</Text>}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The region's emergency number as one call button, or, with no known number, urgent care's local-emergency line and a
 * button that opens the dialer.
 */
export function EmergencyCallRow({ testID }: { testID: string }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const region = phoneRegion();
  const number = emergencyNumber(region);
  const regionKey = region === null ? null : `region.${region.toLowerCase()}`;
  const regionName = regionKey !== null && isMessageKey(regionKey) ? t(regionKey) : null;

  if (number === null) {
    return (
      <View style={styles.row}>
        <Text style={[styles.strong, { color: color.text }]}>{t('redflag.unknown')}</Text>
        <CallButton
          testID={testID}
          label={t('redflag.open_dialer')}
          sub={null}
          disabled={false}
          onPress={() => {
            dial('');
          }}
        />
      </View>
    );
  }
  return (
    <CallButton
      testID={testID}
      label={t('redflag.call', { number })}
      sub={regionName === null ? null : t('redflag.call_sub', { region: regionName })}
      disabled={false}
      onPress={() => {
        dial(number);
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { gap: space[2] },
  strong: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  call: {
    minHeight: crisisControlHeight,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[4],
    borderRadius: radius.control,
    overflow: 'hidden',
  },
  pressLayer: { ...StyleSheet.absoluteFill, opacity: 0.16 },
  fill: { ...StyleSheet.absoluteFill },
  callRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1] },
  callLabel: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27, textAlign: 'center' },
  callSub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20, textAlign: 'center' },
});
