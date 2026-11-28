// Hands a red-flag hit to the urgent-care screen in memory, so no health text travels in a route param.
import { router } from 'expo-router';

import type { RedFlagKey } from '../condition';

export interface UrgentCareRequest {
  flags: readonly RedFlagKey[];
  /** What the user wrote or said, shown back to them; null for a duration hit. */
  excerpt: string | null;
  source: 'text' | 'voice' | 'duration';
  /** The open episode a duration hit is about, for "It already ended". */
  episodeId: string | null;
}

let current: UrgentCareRequest | null = null;

export function showUrgentCare(request: UrgentCareRequest): void {
  current = request;
  router.push('/urgent-care');
}

/** The pending request; null when the screen is opened without one (a deep link), which still offers the call. */
export function currentUrgentCare(): UrgentCareRequest | null {
  return current;
}

/** Drops the request, health text included: when the screen goes and when the account changes. */
export function clearUrgentCare(): void {
  current = null;
}
