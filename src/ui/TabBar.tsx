import { BlurView } from 'expo-blur';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ComponentRef, ComponentType, RefObject } from 'react';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { IconProps } from './Button';
import { easingFor, spring, useMotion } from './motion';
import type { MotionPreset } from './motion';
import { fonts, space } from './theme';
import type { ThemeColors, ThemeTones } from './theme';
import { useTheme, useTones } from './themeContext';
import { useAccessibilityFlag } from './useAccessibilityFlag';
import { usePressFeedback } from './usePressFeedback';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon: ComponentType<IconProps>;
}

interface TabBarProps<K extends string> {
  tabs: readonly TabItem<K>[];
  current: K;
  onSelect: (key: K) => void;
  accessibilityLabel: string;
  /** Android blurs only the content of a `BlurTargetView`; pass the one around the screens. */
  blurTarget?: RefObject<BlurTarget | null>;
}

type BlurTarget = ComponentRef<typeof View>;

const PADDING = 6;
const GAP = 2;
const TAB_HEIGHT = 52;
const RADIUS = 32;
/** The bar's own height: the tabs, its padding and its 1 pt edge. */
export const TAB_BAR_HEIGHT = TAB_HEIGHT + PADDING * 2 + 2;

function barBottom(safeBottom: number): number {
  return Math.max(safeBottom - space[1], space[2]);
}

/** How much a screen must leave free at its end so its last row scrolls clear of the floating bar. */
export function useTabBarInset(): number {
  return barBottom(useSafeAreaInsets().bottom) + TAB_BAR_HEIGHT + space[2];
}

type Material = 'opaque' | 'glass' | 'blur';

function useMaterial(): Material {
  // Unknown until the OS answers: a first frame of glass would flash for a user who asked for none.
  const reduceTransparency = useAccessibilityFlag('reduceTransparencyChanged');
  if (reduceTransparency !== false) return 'opaque';
  // Some iOS 26 betas lack the API and crash on a GlassView.
  return isLiquidGlassAvailable() && isGlassEffectAPIAvailable() ? 'glass' : 'blur';
}

interface Paint {
  material: Material;
  dark: boolean;
  color: ThemeColors;
  tone: ThemeTones;
}

function Backdrop({ material, dark, color, tone, blurTarget }: Paint & { blurTarget: RefObject<BlurTarget | null> | undefined }): React.JSX.Element {
  if (material === 'opaque') {
    return <View testID="tab-bar-opaque" style={[StyleSheet.absoluteFill, { backgroundColor: color.surface }]} />;
  }
  if (material === 'glass') {
    return (
      <GlassView
        testID="tab-bar-glass"
        glassEffectStyle="regular"
        colorScheme={dark ? 'dark' : 'light'}
        // Dark and Dim tint the system glass with their own dense surface, so it stays a dark glass.
        {...(dark ? { tintColor: tone.glassTop } : {})}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  // Android blurs only a BlurTargetView's content; without one, the tinted fill alone is the glass.
  const blur = Platform.OS !== 'android' || blurTarget !== undefined;
  return (
    <>
      {blur ? (
        <BlurView
          testID="tab-bar-blur"
          intensity={40}
          tint={dark ? 'dark' : 'light'}
          blurMethod="dimezisBlurViewSdk31Plus"
          {...(blurTarget === undefined ? {} : { blurTarget })}
          // Android draws the blur outside the capsule's clip; the view clips itself to its own radius.
          style={[StyleSheet.absoluteFill, { borderRadius: RADIUS - 1 }]}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundImage: `linear-gradient(180deg, ${tone.glassTop}, ${tone.glassBottom})`,
            boxShadow: `inset 0px 1px 0px ${tone.glassHighlight}`,
          },
        ]}
      />
    </>
  );
}

function pillPaint({ material, tone }: Paint): { backgroundColor: string; boxShadow: string } {
  return material === 'opaque'
    ? { backgroundColor: tone.opaquePill, boxShadow: `0px 0px 0px 1px ${tone.opaquePillEdge}` }
    : { backgroundColor: tone.glassPill, boxShadow: `inset 0px 1px 0px ${tone.glassHighlight}, 0px 0px 0px 1px ${tone.glassPillEdge}` };
}

/** Full motion: one pill glides to the current tab on a spring. */
function SlidingPill({ index, count, width, motion, paint }: { index: number; count: number; width: number; motion: MotionPreset; paint: Paint }): React.JSX.Element {
  const tabWidth = count > 0 ? (width - GAP * (count - 1)) / count : 0;
  const x = useSharedValue(index * (tabWidth + GAP));
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  useEffect(() => {
    x.set(withSpring(index * (tabWidth + GAP), { duration: motion.duration.base, ...spring, reduceMotion: ReduceMotion.Never }));
  }, [x, index, tabWidth, motion.duration.base]);

  return <Animated.View pointerEvents="none" style={[styles.pill, { width: tabWidth }, pillPaint(paint), pillStyle]} />;
}

/** Subtle and fade: each tab's own pill cross-fades, since a tab's width is far more than an 8 pt move. */
function FadingPill({ selected, motion, paint }: { selected: boolean; motion: MotionPreset; paint: Paint }): React.JSX.Element {
  const shown = useSharedValue(selected ? 1 : 0);
  const pillStyle = useAnimatedStyle(() => ({ opacity: shown.get() }));

  useEffect(() => {
    shown.set(
      withTiming(selected ? 1 : 0, {
        duration: motion.duration.fast,
        easing: easingFor(motion.level),
        reduceMotion: ReduceMotion.Never,
      }),
    );
  }, [shown, selected, motion.duration.fast, motion.level]);

  return <Animated.View pointerEvents="none" style={[styles.pill, StyleSheet.absoluteFill, pillPaint(paint), pillStyle]} />;
}

interface TabProps<K extends string> {
  tab: TabItem<K>;
  selected: boolean;
  onSelect: (key: K) => void;
  motion: MotionPreset;
  paint: Paint;
}

function Tab<K extends string>({ tab, selected, onSelect, motion, paint }: TabProps<K>): React.JSX.Element {
  const { scaleStyle, pressedStyle, onPressIn, onPressOut } = usePressFeedback();
  const ink = selected ? paint.tone.tabCurrent : paint.tone.tabIdle;
  const Icon = tab.icon;
  return (
    <Animated.View style={[styles.tabFrame, scaleStyle]}>
      <Pressable
        testID={`tab-${tab.key}`}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={tab.label}
        // Labels keep a fixed size so the bar keeps one height; a long press shows them enlarged (iOS).
        accessibilityShowsLargeContentViewer
        accessibilityLargeContentTitle={tab.label}
        onPress={() => {
          if (!selected) onSelect(tab.key);
        }}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={styles.tab}
      >
        {motion.level === 'full' ? null : <FadingPill selected={selected} motion={motion} paint={paint} />}
        <Animated.View pointerEvents="none" style={[styles.pill, StyleSheet.absoluteFill, { backgroundColor: paint.tone.pressSecondary }, pressedStyle]} />
        <Icon size={24} color={ink} />
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={1}
          style={[styles.label, { color: ink, fontFamily: selected ? fonts.bodyBold : fonts.bodySemiBold }]}
        >
          {tab.label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/** A floating Liquid Glass bar; opaque `surface` when the OS asks to reduce transparency. */
export function TabBar<K extends string>({ tabs, current, onSelect, accessibilityLabel, blurTarget }: TabBarProps<K>): React.JSX.Element {
  const { name, color } = useTheme();
  const tone = useTones();
  const motion = useMotion();
  const material = useMaterial();
  const insets = useSafeAreaInsets();
  const [rowWidth, setRowWidth] = useState(0);
  const paint: Paint = { material, dark: name !== 'day', color, tone };
  const currentIndex = tabs.findIndex((tab) => tab.key === current);
  const opaque = material === 'opaque';
  const shadow = opaque ? tone.raise : tone.glassShadow;

  return (
    // The shadow sits on this unclipped wrapper; the capsule clips the material to its radius.
    <View
      pointerEvents="box-none"
      style={[styles.frame, { bottom: barBottom(insets.bottom) }, shadow === 'none' ? null : { boxShadow: shadow }]}
    >
      <View style={[styles.capsule, { borderColor: opaque ? color.border : tone.glassEdge }]}>
        <Backdrop {...paint} blurTarget={blurTarget} />
        <View
          accessibilityRole="tablist"
          accessibilityLabel={accessibilityLabel}
          style={styles.row}
          onLayout={(event: LayoutChangeEvent) => {
            setRowWidth(event.nativeEvent.layout.width);
          }}
        >
          {motion.level === 'full' && currentIndex >= 0 && rowWidth > 0 ? (
            <SlidingPill index={currentIndex} count={tabs.length} width={rowWidth} motion={motion} paint={paint} />
          ) : null}
          {tabs.map((tab) => (
            <Tab
              key={tab.key}
              tab={tab}
              selected={tab.key === current}
              onSelect={onSelect}
              motion={motion}
              paint={paint}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: space[2], right: space[2], borderRadius: RADIUS },
  capsule: { borderRadius: RADIUS, borderWidth: 1, overflow: 'hidden', padding: PADDING },
  row: { flexDirection: 'row', gap: GAP },
  tabFrame: { flex: 1 },
  tab: {
    flex: 1,
    minHeight: TAB_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: space[0],
    paddingHorizontal: 2,
    borderRadius: 26,
  },
  pill: { position: 'absolute', top: 0, bottom: 0, left: 0, borderRadius: 26 },
  label: { fontSize: 13, lineHeight: 16, textAlign: 'center' },
});
