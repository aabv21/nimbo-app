// The tab's empty state and its notes for offline, unavailable and over the quota; records never wait on the companion.
import { Lock } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n';
import { Button } from '../ui/Button';
import { controlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';
import { usePressFeedback } from '../ui/usePressFeedback';
import type { CompanionState } from './useCompanion';

const SUGGESTIONS: readonly MessageKey[] = ['companion.suggest.common', 'companion.suggest.log_sleep', 'companion.suggest.med_days'];

function Suggestion({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: (text: string) => void }): React.JSX.Element {
  const { color } = useTheme();
  const tones = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  return (
    <Animated.View style={[styles.suggestionFrame, scaleStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          onPress(label);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[styles.suggestion, { borderColor: color.border }]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tones.pressSecondary }, pressedStyle]} />
        <Text style={[styles.suggestionLabel, { color: disabled ? color.textMuted : color.text }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** The first conversation: what to ask, as chips that send their own words. */
export function EmptyState({ disabled, onSuggest }: { disabled: boolean; onSuggest: (text: string) => void }): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={styles.spacer} />
      <Text style={[styles.display, { color: color.text }]}>{t('companion.empty.title')}</Text>
      <Text style={[styles.lede, { color: color.textMuted }]}>{t('companion.empty.body')}</Text>
      <View style={styles.section}>
        <Text accessibilityRole="header" style={[styles.heading, { color: color.text }]}>
          {t('companion.suggest.label')}
        </Text>
        {SUGGESTIONS.map((key) => (
          <Suggestion key={key} label={t(key)} disabled={disabled} onPress={onSuggest} />
        ))}
      </View>
      <View style={styles.privacy}>
        <Lock size={16} color={color.textMuted} />
        <Text style={[styles.caption, styles.grow, { color: color.textMuted }]}>{t('companion.privacy')}</Text>
      </View>
    </View>
  );
}

interface StateNoticeProps {
  state: CompanionState;
  /** The companion quota the server reported today; only read over the quota. */
  limit: number | null;
  onLogDose: () => void;
  onCheckin: () => void;
}

/** One sentence on why the companion cannot answer now, and the manual forms when it is down or used up. */
export function StateNotice({ state, limit, onLogDose, onCheckin }: StateNoticeProps): React.JSX.Element | null {
  const { t } = useI18n();
  const { color } = useTheme();
  if (state === 'ready') return null;
  const copy =
    state === 'offline'
      ? { title: t('companion.offline.title'), body: t('companion.offline.body') }
      : state === 'unavailable'
        ? { title: t('companion.down.title'), body: t('companion.down.body') }
        : { title: t('companion.quota.title', { limit: limit ?? 0 }), body: t('companion.quota.body') };
  return (
    <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: color.surface, borderColor: color.border }]}>
      <Text style={[styles.noticeTitle, { color: color.text }]}>{copy.title}</Text>
      <Text style={[styles.noticeBody, { color: color.text }]}>{copy.body}</Text>
      {state === 'offline' ? null : (
        <View style={styles.manual}>
          <Button variant="secondary" label={t('companion.manual.dose')} onPress={onLogDose} />
          <Button variant="secondary" label={t('companion.manual.checkin')} onPress={onCheckin} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flexGrow: 1, gap: space[4] },
  spacer: { flexGrow: 1 },
  display: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  lede: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  section: { gap: space[2] },
  heading: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  suggestionFrame: { alignSelf: 'flex-start', maxWidth: '100%' },
  suggestion: {
    minHeight: controlHeight,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pressed: { ...StyleSheet.absoluteFill, opacity: 0 },
  suggestionLabel: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  grow: { flex: 1 },
  notice: { gap: space[1], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  noticeTitle: { fontFamily: fonts.bodyBold, fontSize: type.body, lineHeight: 24 },
  noticeBody: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  manual: { gap: space[1], marginTop: space[1] },
});
