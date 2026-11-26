import type { Profile } from './profileRepository';

export type TabName = 'today' | 'companion' | 'history' | 'profile';

const ALL: readonly TabName[] = ['today', 'companion', 'history', 'profile'];
const WITHOUT_AI: readonly TabName[] = ['today', 'history', 'profile'];

/** With the AI off the companion tab is gone, not disabled: the rest of the app is complete without it. */
export function visibleTabs(profile: Pick<Profile, 'aiEnabled'>): readonly TabName[] {
  return profile.aiEnabled ? ALL : WITHOUT_AI;
}
