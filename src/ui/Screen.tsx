import { StatusBar } from 'expo-status-bar';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { space } from './theme';
import { useTheme } from './themeContext';

interface ScreenProps {
  children: ReactNode;
  /** A screen scrolls unless its content is fixed (a sheet, a full-screen state). */
  scroll?: boolean;
  /** Extra room at the end for what floats over the content (the tab bar, a docked action). */
  bottomInset?: number;
  contentStyle?: StyleProp<ViewStyle>;
  /** For a screen that scrolls to one of its parts (Today's check-in). */
  scrollRef?: Ref<ComponentRef<typeof ScrollView>>;
}

/** A screen's ground: the theme background, the safe area, and the design's gutters and rhythm. */
export function Screen({ children, scroll = true, bottomInset = 0, contentStyle, scrollRef }: ScreenProps): React.JSX.Element {
  const { name, color } = useTheme();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + space[2],
    paddingBottom: Math.max(insets.bottom, space[5]) + bottomInset,
    paddingLeft: insets.left + space[3],
    paddingRight: insets.right + space[3],
  };

  return (
    <View style={[styles.root, { backgroundColor: color.bg }]}>
      <StatusBar style={name === 'day' ? 'dark' : 'light'} />
      {scroll ? (
        <ScrollView
          ref={scrollRef}
          style={styles.root}
          contentContainerStyle={[styles.content, padding, contentStyle]}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="never"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.root, styles.content, padding, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, gap: space[4] },
});
