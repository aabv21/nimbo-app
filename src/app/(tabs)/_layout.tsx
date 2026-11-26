import { BlurTargetView } from 'expo-blur';
import { TabSlot, defaultTabsSlotRender, useTabTrigger, useTabsWithTriggers } from 'expo-router/ui';
import type { TabsSlotRenderOptions } from 'expo-router/ui';
import { CalendarDays, House, MessageCircle, UserRound } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentRef, ComponentType, ReactNode, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useAuth } from '../../auth/AuthProvider';
import { toHref } from '../../auth/routes';
import { useI18n } from '../../i18n';
import { visibleTabs } from '../../profile/tabs';
import type { TabName } from '../../profile/tabs';
import { useTimezoneSync } from '../../profile/useTimezoneSync';
import type { IconProps } from '../../ui/Button';
import { easingFor, useMotion } from '../../ui/motion';
import { TabBar } from '../../ui/TabBar';
import { useTheme } from '../../ui/themeContext';

const ICONS: ReadonlyMap<TabName, ComponentType<IconProps>> = new Map<TabName, ComponentType<IconProps>>([
  ['today', House],
  ['companion', MessageCircle],
  ['history', CalendarDays],
  ['profile', UserRound],
]);

type BlurTarget = ComponentRef<typeof View>;
type ScreenTrigger = Parameters<typeof useTabsWithTriggers>[0]['triggers'][number];

/** The new tab's content rises in (fades only, at reduced motion); tabs are peers, so nothing slides sideways. */
function TabScene({ focused, still, children }: { focused: boolean; still: boolean; children: ReactNode }): React.JSX.Element {
  const motion = useMotion();
  const shown = useSharedValue(still ? 1 : 0);
  const rise = motion.level === 'full' ? 12 : motion.level === 'subtle' ? 8 : 0;
  const style = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * rise }],
  }));
  const first = useRef(still);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!focused) return;
    shown.set(0);
    shown.set(withTiming(1, { duration: motion.duration.base, easing: easingFor(motion.level), reduceMotion: ReduceMotion.Never }));
  }, [focused, shown, motion.duration.base, motion.level]);

  return <Animated.View style={[styles.fill, style]}>{children}</Animated.View>;
}

/** Wraps each screen in a `TabScene`; the tab the shell opens on appears as it is, since only a change of tab animates. */
function sceneRenderer(initialRouteKey: string | undefined): typeof defaultTabsSlotRender {
  return (descriptor, options: TabsSlotRenderOptions) =>
    defaultTabsSlotRender(
      {
        ...descriptor,
        render: () => (
          <TabScene focused={options.isFocused} still={descriptor.route.key === initialRouteKey}>
            {descriptor.render()}
          </TabScene>
        ),
      },
      options,
    );
}

function ShellTabBar({ tabs, current, blurTarget }: { tabs: readonly TabName[]; current: TabName; blurTarget: RefObject<BlurTarget | null> }): React.JSX.Element {
  const { t } = useI18n();
  const { switchTab } = useTabTrigger({ name: current });
  const items = tabs.map((key) => ({ key, label: t(`tabs.${key}`), icon: ICONS.get(key) ?? House }));
  return (
    <TabBar
      tabs={items}
      current={current}
      onSelect={(key) => {
        switchTab(key, {});
      }}
      accessibilityLabel={t('tabs.label')}
      blurTarget={blurTarget}
    />
  );
}

function isTabName(name: string | undefined, tabs: readonly TabName[]): name is TabName {
  return tabs.some((tab) => tab === name);
}

/**
 * Headless tabs, so the screens sit inside one `BlurTargetView` with the floating bar beside it: Android
 * blurs only that view's content. The tab list follows the AI switch; a hidden tab has no trigger at all.
 */
export default function TabsLayout(): React.JSX.Element {
  const { profile } = useAuth();
  const { color } = useTheme();
  const blurTarget = useRef<BlurTarget>(null);
  useTimezoneSync();

  const tabs = visibleTabs({ aiEnabled: profile?.aiEnabled === true });
  const triggers = useMemo<ScreenTrigger[]>(
    () => tabs.map((name) => ({ type: 'internal', name, href: toHref(`/${name}`) })),
    [tabs],
  );
  const { state, NavigationContent } = useTabsWithTriggers({ triggers });
  const focusedRoute = state.routes[state.index];
  const current = isTabName(focusedRoute?.name, tabs) ? focusedRoute.name : 'today';
  const [initialRouteKey] = useState(focusedRoute?.key);

  return (
    <NavigationContent>
      <View style={[styles.fill, { backgroundColor: color.bg }]}>
        <BlurTargetView ref={blurTarget} style={styles.fill}>
          <TabSlot renderFn={sceneRenderer(initialRouteKey)} />
        </BlurTargetView>
        <ShellTabBar tabs={tabs} current={current} blurTarget={blurTarget} />
      </View>
    </NavigationContent>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
