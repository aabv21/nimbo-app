// Where it hurts, on an outline of the head: front and back views of large regions, sides named from the user's view.
import { Check, X } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, Path } from 'react-native-svg';

import { isMessageKey, useI18n } from '../i18n';
import { controlHeight, crisisControlHeight, fonts, radius, space, type } from '../ui/theme';
import { useTheme, useTones } from '../ui/themeContext';

type HeadView = 'front' | 'back';

interface Region {
  key: string;
  /** In the 220 × 250 drawing. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Cut to the head's outline; the neck sits below it. */
  clipped: boolean;
}

// Facing the user, their right is on the screen's left. Later regions win where the 48 pt targets overlap.
const REGIONS: Readonly<Record<HeadView, readonly Region[]>> = {
  front: [
    { key: 'crown', x: 0, y: 0, w: 220, h: 52, clipped: true },
    { key: 'forehead', x: 0, y: 52, w: 220, h: 44, clipped: true },
    { key: 'temple_right', x: 0, y: 96, w: 80, h: 44, clipped: true },
    { key: 'temple_left', x: 140, y: 96, w: 80, h: 44, clipped: true },
    { key: 'face', x: 0, y: 140, w: 220, h: 64, clipped: true },
    { key: 'eye_right', x: 80, y: 96, w: 30, h: 44, clipped: true },
    { key: 'eye_left', x: 110, y: 96, w: 30, h: 44, clipped: true },
  ],
  back: [
    { key: 'neck', x: 80, y: 192, w: 60, h: 52, clipped: false },
    { key: 'crown', x: 0, y: 0, w: 220, h: 72, clipped: true },
    { key: 'back_left', x: 0, y: 72, w: 110, h: 132, clipped: true },
    { key: 'back_right', x: 110, y: 72, w: 110, h: 132, clipped: true },
  ],
};

const DRAWING = { width: 220, height: 250 } as const;
const HEAD = { cx: 110, cy: 112, rx: 74, ry: 92 } as const;
const MAX_SCALE = 1.5;
const MIN_TARGET = controlHeight;

const NECK_RADIUS = 10;

/** The region's path: a band cut to the head by the clip, or the neck's rounded block. */
function outline({ x, y, w, h, clipped }: Region): string {
  const r = clipped ? 0 : NECK_RADIUS;
  const n = (value: number): string => String(value);
  return [
    `M${n(x + r)} ${n(y)}`,
    `H${n(x + w - r)}`,
    `Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}`,
    `V${n(y + h - r)}`,
    `Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}`,
    `H${n(x + r)}`,
    `Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}`,
    `V${n(y + r)}`,
    `Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}`,
    'Z',
  ].join(' ');
}

interface RegionButtonProps {
  view: HeadView;
  region: Region;
  scale: number;
  label: string;
  checked: boolean;
  onToggle: (key: string) => void;
}

/** The region's own path, drawn inside a pressable at least 48 pt each way and centred on it. */
function RegionButton({ view, region, scale, label, checked, onToggle }: RegionButtonProps): React.JSX.Element {
  const { color } = useTheme();
  const { x, y, w, h } = region;
  const width = Math.max(w * scale, MIN_TARGET);
  const height = Math.max(h * scale, MIN_TARGET);
  const clipId = `head-${view}-${region.key}`;

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      onPress={() => {
        onToggle(region.key);
      }}
      style={{
        position: 'absolute',
        left: x * scale - (width - w * scale) / 2,
        top: y * scale - (height - h * scale) / 2,
        width,
        height,
      }}
    >
      <Svg
        width={w * scale}
        height={h * scale}
        viewBox={`${String(x)} ${String(y)} ${String(w)} ${String(h)}`}
        style={{ position: 'absolute', left: (width - w * scale) / 2, top: (height - h * scale) / 2 }}
      >
        <Defs>
          <ClipPath id={clipId}>
            <Ellipse {...HEAD} />
          </ClipPath>
        </Defs>
        <Path
          d={outline(region)}
          fill={color.accent}
          fillOpacity={checked ? 0.45 : 0}
          stroke={color.border}
          strokeWidth={1}
          {...(region.clipped ? { clipPath: `url(#${clipId})` } : {})}
        />
        {/* The neck runs under the head, as in the outline. */}
        {region.clipped ? null : <Ellipse {...HEAD} fill={color.bg} />}
      </Svg>
    </Pressable>
  );
}

interface HeadMapProps {
  value: readonly string[];
  onChange: (areas: readonly string[]) => void;
}

export function HeadMap({ value, onChange }: HeadMapProps): React.JSX.Element {
  const { t } = useI18n();
  const { color } = useTheme();
  const tones = useTones();
  const { width: windowWidth } = useWindowDimensions();
  const [view, setView] = useState<HeadView>('front');
  const scale = Math.min(MAX_SCALE, (windowWidth - 2 * space[3]) / DRAWING.width);

  const labelOf = (area: string): string => {
    const key = `condition.painAreas.${area}`;
    return isMessageKey(key) ? t(key) : area;
  };
  const toggle = (area: string): void => {
    onChange(value.includes(area) ? value.filter((key) => key !== area) : [...value, area]);
  };
  const sides = view === 'front' ? [t('crisis.where.your_right'), t('crisis.where.your_left')] : [t('crisis.where.your_left'), t('crisis.where.your_right')];

  return (
    <View style={styles.root}>
      <View accessibilityRole="tablist" accessibilityLabel={t('crisis.where.views')} style={[styles.tabs, { borderColor: color.border }]}>
        {(['front', 'back'] as const).map((option) => {
          const selected = option === view;
          return (
            <Pressable
              key={option}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t(option === 'front' ? 'crisis.where.front' : 'crisis.where.back')}
              onPress={() => {
                setView(option);
              }}
              style={[styles.tab, selected && { backgroundColor: tones.opaquePill, boxShadow: `inset 0px 0px 0px 2px ${color.accent}` }]}
            >
              <Text style={[styles.tabLabel, { color: selected ? color.text : color.textMuted }, selected && styles.bold]}>
                {t(option === 'front' ? 'crisis.where.front' : 'crisis.where.back')}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.sides, { width: DRAWING.width * scale }]}>
        {sides.map((side) => (
          <Text key={side} style={[styles.caption, { color: color.textMuted }]}>
            {side}
          </Text>
        ))}
      </View>
      <View style={{ width: DRAWING.width * scale, height: DRAWING.height * scale }}>
        {(view === 'front' ? REGIONS.front : REGIONS.back).map((region) => (
          <RegionButton
            key={region.key}
            view={view}
            region={region}
            scale={scale}
            label={labelOf(region.key)}
            checked={value.includes(region.key)}
            onToggle={toggle}
          />
        ))}
        <Svg
          pointerEvents="none"
          width={DRAWING.width * scale}
          height={DRAWING.height * scale}
          viewBox={`0 0 ${String(DRAWING.width)} ${String(DRAWING.height)}`}
          style={StyleSheet.absoluteFill}
        >
          <Ellipse {...HEAD} fill="none" stroke={color.textMuted} strokeWidth={2} />
        </Svg>
      </View>

      {value.length === 0 ? null : (
        <View style={styles.marked}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: color.text }]}>
            {t('crisis.where.marked')}
          </Text>
          <View style={styles.chips}>
            {value.map((area) => (
              <Pressable
                key={area}
                accessibilityRole="button"
                accessibilityLabel={labelOf(area)}
                accessibilityHint={t('crisis.where.remove')}
                onPress={() => {
                  toggle(area);
                }}
                style={[styles.chip, { backgroundColor: tones.opaquePill, borderColor: color.accent }]}
              >
                <Check size={18} color={color.text} />
                <Text style={[styles.chipLabel, { color: color.text }]}>{labelOf(area)}</Text>
                <X size={18} color={color.textMuted} />
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: space[3] },
  tabs: { flexDirection: 'row', alignSelf: 'stretch', borderWidth: 1, borderRadius: radius.control, padding: space[0], gap: space[0] },
  tab: { flex: 1, minHeight: controlHeight, alignItems: 'center', justifyContent: 'center', borderRadius: radius.control - space[0] },
  tabLabel: { fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
  bold: { fontFamily: fonts.bodyBold },
  sides: { flexDirection: 'row', justifyContent: 'space-between' },
  caption: { fontFamily: fonts.body, fontSize: type.caption, lineHeight: 18 },
  marked: { alignSelf: 'stretch', gap: space[2] },
  sectionTitle: { fontFamily: fonts.bodyBold, fontSize: type.label, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[1] },
  chip: {
    maxWidth: '100%',
    minHeight: crisisControlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[3],
    borderRadius: radius.control,
    borderWidth: 1,
  },
  chipLabel: { flexShrink: 1, fontFamily: fonts.body, fontSize: type.body, lineHeight: 22 },
});
