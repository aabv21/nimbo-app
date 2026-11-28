// "Read aloud": a toggle that reads `text` with the app-language voice; nothing when the phone has none.
// `crisis` is 56 pt, like every crisis-mode control.
import { Square, Volume2 } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import { controlHeight, crisisControlHeight, radius } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import { useSpeaker } from './speech';

export function ListenButton({
  text,
  autoPlay = false,
  size = 'regular',
}: {
  text: string;
  autoPlay?: boolean;
  size?: 'regular' | 'crisis';
}): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const speaker = useSpeaker(text, { autoPlay });
  if (speaker.hidden) return null;
  const Icon = speaker.speaking ? Square : Volume2;
  return (
    <Animated.View style={scaleStyle}>
      <Pressable
        accessibilityRole="togglebutton"
        accessibilityLabel={t('crisis.read_aloud')}
        accessibilityState={{ checked: speaker.speaking }}
        onPress={speaker.toggle}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.button,
          size === 'crisis' && styles.crisis,
          { borderColor: color.border },
          speaker.speaking && { backgroundColor: tones.opaquePill },
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Icon size={22} color={color.accentText} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: controlHeight,
    height: controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  crisis: { width: crisisControlHeight, height: crisisControlHeight },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
});
