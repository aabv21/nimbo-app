// Type guards the functions share for values that come from outside: request bodies, rows, tokens.

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A plain JSON object: not null, not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// System One's probability-weighted values can land a rounding error outside their range (1.0000000002).
const RANGE_TOLERANCE = 1e-9;

/** `value` clamped to [min, max] when it is a finite number within the tolerance of that range; otherwise null. */
export function inRange(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min - RANGE_TOLERANCE || value > max + RANGE_TOLERANCE) return null;
  return Math.min(max, Math.max(min, value));
}
