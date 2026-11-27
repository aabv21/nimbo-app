import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { controlHeight, fonts, radius, space, type } from './theme';
import { useTheme, useTones } from './themeContext';
import { usePressFeedback } from './usePressFeedback';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** A second line under the label; not shown in the `segmented` layout. */
  sub?: string;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  choices: readonly Choice<T>[];
  /** Null while nothing is chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
  /** `segmented`: short labels side by side, wrapping two by two. `list`: one row per choice. `cards`: one card per choice. */
  layout: 'segmented' | 'list' | 'cards';
}

function Option<T extends string>({
  choice,
  selected,
  layout,
  onChange,
}: {
  choice: Choice<T>;
  selected: boolean;
  layout: ChoiceGroupProps<T>['layout'];
  onChange: (value: T) => void;
}): React.JSX.Element {
  const { color } = useTheme();
  const tone = useTones();
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const segmented = layout === 'segmented';
  const cards = layout === 'cards';

  return (
    <Animated.View style={[segmented ? styles.segmentFrame : null, scaleStyle]}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={choice.label}
        {...(choice.sub === undefined || segmented ? {} : { accessibilityHint: choice.sub })}
        accessibilityState={{ checked: selected }}
        onPress={() => {
          if (!selected) onChange(choice.value);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          segmented ? styles.segment : cards ? styles.card : styles.listRow,
          segmented && selected
            ? { backgroundColor: tone.opaquePill, boxShadow: `inset 0px 0px 0px 2px ${color.accent}` }
            : null,
          segmented ? null : { borderColor: cards && selected ? color.accent : color.border },
          cards ? { backgroundColor: color.surface } : null,
          cards && selected ? { boxShadow: `inset 0px 0px 0px 1px ${color.accent}` } : null,
        ]}
      >
        <Animated.View pointerEvents="none" style={[styles.pressed, { backgroundColor: tone.pressSecondary }, pressedStyle]} />
        {segmented ? null : (
          <View style={[styles.radio, { borderColor: selected ? color.accent : color.textMuted }]}>
            {selected ? <View style={[styles.dot, { backgroundColor: color.accent }]} /> : null}
          </View>
        )}
        {segmented || choice.sub === undefined ? (
          <Text
            style={[
              segmented ? styles.segmentLabel : styles.listLabel,
              { color: selected || !segmented ? color.text : color.textMuted },
              selected ? { fontFamily: fonts.bodyBold } : null,
            ]}
          >
            {choice.label}
          </Text>
        ) : (
          <View style={styles.listText}>
            <Text style={[styles.listTitle, { color: color.text }]}>{choice.label}</Text>
            <Text style={[styles.listSub, { color: color.textMuted }]}>{choice.sub}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** One choice out of a few, announced as a radio group. */
export function ChoiceGroup<T extends string>({ label, choices, value, onChange, layout }: ChoiceGroupProps<T>): React.JSX.Element {
  const { color } = useTheme();
  const style =
    layout === 'segmented'
      ? [styles.segments, { borderColor: color.textMuted }]
      : layout === 'cards'
        ? styles.cards
        : [styles.list, { borderColor: color.border }];
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={style}
    >
      {choices.map((choice) => (
        <Option key={choice.value} choice={choice} selected={choice.value === value} layout={layout} onChange={onChange} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: space[0], padding: space[0], borderRadius: radius.control, borderWidth: 1 },
  // Two per line at most, so a long es or pt label wraps inside its segment rather than off the screen.
  segmentFrame: { flexGrow: 1, flexBasis: '40%' },
  segment: {
    minHeight: controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space[0],
    paddingHorizontal: space[1],
    borderRadius: 8,
    overflow: 'hidden',
  },
  segmentLabel: { fontFamily: fonts.bodySemiBold, fontSize: type.label, lineHeight: 18, textAlign: 'center' },
  list: { borderTopWidth: 1 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: controlHeight,
    paddingVertical: space[1],
    borderBottomWidth: 1,
  },
  cards: { gap: space[2] },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[2],
    minHeight: controlHeight + space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
    overflow: 'hidden',
  },
  listLabel: { flex: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 24 },
  listText: { flex: 1, gap: 2 },
  listTitle: { fontFamily: fonts.bodySemiBold, fontSize: type.body, lineHeight: 24 },
  listSub: { fontFamily: fonts.body, fontSize: type.label, lineHeight: 20 },
  pressed: { ...StyleSheet.absoluteFill, borderRadius: 8, opacity: 0 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
