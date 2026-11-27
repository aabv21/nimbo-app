import { BlurTargetView } from 'expo-blur';
import { TabSlot, defaultTabsSlotRender, useTabTrigger, useTabsWithTriggers } from 'expo-router/ui';
import type { TabsSlotRenderOptions } from 'expo-router/ui';
import { CalendarDays, House, MessageCircle, UserRound } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import type { ComponentRef, ComponentType, RefObject } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '../../auth/AuthProvider';
import { useI18n } from '../../i18n';
import { visibleTabs } from '../../profile/tabs';
import type { TabName } from '../../profile/tabs';
import { useTimezoneSync } from '../../profile/useTimezoneSync';
import type { IconProps } from '../../ui/Button';
import { TabBar } from '../../ui/TabBar';
import { TabScene } from '../../ui/TabScene';
import { useTheme } from '../../ui/themeContext';

const ICONS: ReadonlyMap<TabName, ComponentType<IconProps>> = new Map<TabName, ComponentType<IconProps>>([
  ['today', House],
  ['companion', MessageCircle],
  ['history', CalendarDays],
  ['profile', UserRound],
]);

type BlurTarget = ComponentRef<typeof View>;
type ScreenTrigger = Parameters<typeof useTabsWithTriggers>[0]['triggers'][number];

/**
 * Wraps each screen in a `TabScene`; the tab the shell opens on appears as it is, since only a change of
 * tab animates. A deep link to a hidden tab is briefly in the state before the tabs drop it, so a route
 * with no trigger renders nothing: the account-state gate stays in this layout, not in the screen.
 */
function sceneRenderer(openedOn: TabName, tabs: readonly TabName[]): typeof defaultTabsSlotRender {
  return (descriptor, options: TabsSlotRenderOptions) => {
    if (!isTabName(descriptor.route.name, tabs)) return null;
    return defaultTabsSlotRender(
      {
        ...descriptor,
        render: () => (
          <TabScene focused={options.isFocused} still={descriptor.route.name === openedOn}>
            {descriptor.render()}
          </TabScene>
        ),
      },
      options,
    );
  };
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
    () => tabs.map((name) => ({ type: 'internal', name, href: `/${name}` })),
    [tabs],
  );
  const { state, NavigationContent } = useTabsWithTriggers({ triggers });
  const focusedRoute = state.routes[state.index];
  const current = isTabName(focusedRoute?.name, tabs) ? focusedRoute.name : 'today';
  // The tab the shell resolves to, not the first render's focused route: a deep link to a hidden tab is the only
  // route for one render, and Today's route arrives after it, so a key taken then would make Today rise in.
  const [openedOn] = useState(current);

  return (
    <NavigationContent>
      <View style={[styles.fill, { backgroundColor: color.bg }]}>
        <BlurTargetView ref={blurTarget} style={styles.fill}>
          <TabSlot renderFn={sceneRenderer(openedOn, tabs)} />
        </BlurTargetView>
        <ShellTabBar tabs={tabs} current={current} blurTarget={blurTarget} />
      </View>
    </NavigationContent>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
