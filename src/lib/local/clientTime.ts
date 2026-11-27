// The phone stores' time check, shared so every store refuses the same times before anything is written or queued.
import { MAX_AHEAD_MS } from '../../condition';

/**
 * Stricter than the server, which stores a time up to a day ahead as now (`private.client_time`) for a clock running
 * fast: a time more than 5 minutes ahead is a mistake to show here, not one to clamp in silence while the mirror keeps it.
 */
export const CLOCK_SKEW_MS = MAX_AHEAD_MS;

const EARLIEST_MS = Date.UTC(2000, 0, 1);

/** The instant of `value`; a `RangeError` for one that is unreadable, before 2000 or more than `CLOCK_SKEW_MS` ahead. */
export function checkedTime(value: string | Date): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms) || ms < EARLIEST_MS || ms > Date.now() + CLOCK_SKEW_MS) throw new RangeError('The time is out of range.');
  return ms;
}
