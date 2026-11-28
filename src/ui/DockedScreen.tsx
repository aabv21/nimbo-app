import { useState } from 'react';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Screen } from './Screen';
import { space } from './theme';
import { useTheme } from './themeContext';

interface DockedScreenProps {
  children: ReactNode;
  /** The actions held at the bottom, outside the scroll, so they stay in the thumb zone at every text size. */
  dock: ReactNode;
  /** How far above the screen's bottom edge the dock sits (the tab bar's room); omitted, it sits on the safe area. */
  above?: number;
}

/** A scrolling screen with a docked action area; the content leaves room for the dock's measured height. */
export function DockedScreen({ children, dock, above }: DockedScreenProps): React.JSX.Element {
  const { color } = useTheme();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const bottom = above ?? 0;

  return (
    <View style={styles.root}>
      <Screen bottomInset={bottom + height}>{children}</Screen>
      <View
        onLayout={(event) => {
          setHeight(event.nativeEvent.layout.height);
        }}
        style={[
          styles.dock,
          {
            bottom,
            paddingBottom: above === undefined ? Math.max(insets.bottom, space[3]) : space[2],
            paddingLeft: insets.left + space[3],
            paddingRight: insets.right + space[3],
            backgroundColor: color.bg,
          },
        ]}
      >
        {dock}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dock: { position: 'absolute', left: 0, right: 0, gap: space[1], paddingTop: space[2] },
});
