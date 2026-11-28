// The order of Today's sections: the onboarding priority sets the base, then what needs the user now goes first.
import type { OveruseLevel } from '../condition';
import type { Priority } from '../profile/profileRepository';

export type TodaySection = 'signals' | 'medication' | 'checkin';

function base(priority: Priority | null): readonly TodaySection[] {
  switch (priority) {
    case 'fewer':
    case 'triggers':
      return ['signals', 'checkin', 'medication'];
    case 'overuse':
      return ['medication', 'signals', 'checkin'];
    case 'logging':
    case null:
      return ['signals', 'medication', 'checkin'];
  }
}

function lift(order: readonly TodaySection[], section: TodaySection): readonly TodaySection[] {
  return [section, ...order.filter((item) => item !== section)];
}

/** A pending check-in moves up first, then medication above its limits moves above everything. */
export function todaySections(input: { priority: Priority | null; overuseLevel: OveruseLevel; checkinDone: boolean }): readonly TodaySection[] {
  let order = base(input.priority);
  if (!input.checkinDone) order = lift(order, 'checkin');
  if (input.overuseLevel !== 'ok') order = lift(order, 'medication');
  return order;
}
