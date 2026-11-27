// The three value screens a signed-out phone opens on once: each shows a real piece of the product, not an
// illustration. Any way out marks the intro seen, so the next launch starts at sign-in.
import { router } from 'expo-router';
import { Check, NotebookText } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatClock, formatDuration } from '../../i18n/format';
import { useI18n } from '../../i18n';
import { markIntroSeen } from '../../onboarding/introSeen';
import { OnboardingStep } from '../../onboarding/OnboardingStep';
import { Button } from '../../ui/Button';
import { entrance, useMotion } from '../../ui/motion';
import { TextLink } from '../../ui/TextLink';
import { fonts, radius, space, themeOf, type } from '../../ui/theme';
import { useTheme } from '../../ui/themeContext';

const SCREENS = [
  { title: 'onb.value1.title', body: 'onb.value1.body' },
  { title: 'onb.value2.title', body: 'onb.value2.body' },
  { title: 'onb.value3.title', body: 'onb.value3.body' },
] as const;

const DIM = themeOf('dim').color;
const EIGHT_AM = new Date(2026, 0, 1, 8, 0);

/** Crisis mode's header as it looks during an attack: always Dim, whatever the phone's theme. */
function CrisisSpecimen(): React.JSX.Element {
  const { t } = useI18n();
  return (
    <View style={[styles.card, { backgroundColor: DIM.bg, borderColor: DIM.border }]}>
      <Text style={[styles.cardTitle, { color: DIM.text }]}>{t('today.status.running')}</Text>
      <View style={styles.timer}>
        <Text style={[styles.number, { color: DIM.text }]}>{formatDuration(0)}</Text>
        <Text style={[styles.small, { color: DIM.textMuted }]}>{t('crisis.just_now')}</Text>
      </View>
      <View style={styles.inline}>
        <Check size={16} color={DIM.textMuted} />
        <Text style={[styles.caption, { color: DIM.textMuted }]}>{t('crisis.saved_local')}</Text>
      </View>
    </View>
  );
}

/** A sentence and the draft it becomes. */
function DraftSpecimen(): React.JSX.Element {
  const { t, locale } = useI18n();
  const { color } = useTheme();
  const rows = [
    [t('draft.k.medication'), t('mock.med.sumatriptan')],
    [t('draft.k.when'), t('draft.v.today_at', { time: formatClock(EIGHT_AM, locale) })],
  ] as const;
  return (
    <View style={styles.chat}>
      <View style={[styles.bubble, { backgroundColor: color.accent }]}>
        <Text style={[styles.body, { color: color.onAccent }]}>{t('mock.chat.u_dose')}</Text>
      </View>
      <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
        <View>
          <Text style={[styles.cardTitle, { color: color.text }]}>{t('draft.dose.title')}</Text>
          <Text style={[styles.small, { color: color.textMuted }]}>{t('draft.sub')}</Text>
        </View>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.pair}>
            <Text style={[styles.small, { color: color.textMuted }]}>{label}</Text>
            <Text style={[styles.body, { color: color.text }]}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** A companion note with the evidence line under it. */
function NoteSpecimen(): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: color.surface, borderColor: color.border }]}>
      <Text style={[styles.byline, { color: color.textMuted }]}>{t('tabs.companion')}</Text>
      <Text style={[styles.note, { color: color.text }]}>{t('mock.note.short_night')}</Text>
      <View style={styles.inline}>
        <NotebookText size={16} color={color.accentText} />
        <Text style={[styles.evidence, { color: color.accentText }]}>{t('evidence.trigger_frequency', { count: 6, of: 8 })}</Text>
      </View>
    </View>
  );
}

function Specimen({ index }: { index: number }): React.JSX.Element {
  switch (index) {
    case 1:
      return <DraftSpecimen />;
    case 2:
      return <NoteSpecimen />;
    default:
      return <CrisisSpecimen />;
  }
}

function leave(to: '/sign-in' | '/sign-up'): void {
  markIntroSeen();
  router.replace(to);
}

export default function Intro(): React.JSX.Element {
  const { t } = useI18n();
  const motion = useMotion();
  const [index, setIndex] = useState(0);
  const screen = SCREENS.at(index) ?? SCREENS[0];
  const last = index === SCREENS.length - 1;

  const dock = last ? (
    <>
      <Button
        label={t('onb.start')}
        onPress={() => {
          leave('/sign-up');
        }}
      />
      <TextLink
        label={t('onb.have_account')}
        align="center"
        onPress={() => {
          leave('/sign-in');
        }}
      />
    </>
  ) : (
    <Button
      label={t('common.next')}
      onPress={() => {
        markIntroSeen();
        setIndex(index + 1);
      }}
    />
  );

  return (
    <OnboardingStep
      done={index + 1}
      total={SCREENS.length}
      onSkip={() => {
        leave('/sign-in');
      }}
      title={t(screen.title)}
      lede={t(screen.body)}
      dock={dock}
    >
      {/* Each Next brings the new specimen up into place; the first one is already there at launch. */}
      <Animated.View key={index} {...(index === 0 ? {} : { entering: entrance(motion, 8) })} style={styles.specimen}>
        <Specimen index={index} />
      </Animated.View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  specimen: { flexGrow: 1, justifyContent: 'flex-end' },
  card: { gap: space[2], padding: space[3], borderRadius: radius.card, borderWidth: 1 },
  cardTitle: { fontFamily: fonts.bodyBold, fontSize: type.title, lineHeight: 27 },
  timer: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: space[2] },
  number: { fontFamily: fonts.display, fontSize: type.display, lineHeight: 34 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  chat: { gap: space[2] },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.card },
  pair: { gap: 2 },
  byline: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  note: { fontFamily: fonts.display, fontSize: type.body, lineHeight: 26 },
  evidence: { flexShrink: 1, fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 20 },
  body: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  small: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
});
