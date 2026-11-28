// The calibration maths and arguments for `pnpm calibrate` (scripts/calibrate.ts). Pure, so the tests
// need no network (docs/ai.md#calibration).

import { parseArgs } from 'node:util';

import type { Intent } from '../supabase/functions/_shared/companion/contract.ts';
import type { Locale } from '../supabase/functions/_shared/condition/index.ts';

/** One fixture's probability for one key, and whether the fixture should raise that key. */
export interface Scored {
  id: string;
  p: number;
  positive: boolean;
}

export type CalibrateArgs = { command: 'eval'; locale: Locale | 'all'; layer: 'jev' | 'claude' };

export const USAGE = 'Usage: pnpm calibrate eval [--locale en|es|pt|all] [--layer jev|claude]';

export class UsageError extends Error {}

/** The highest threshold at which every positive is caught (min p over positives); null with no positive. */
export function zeroMissThreshold(scores: readonly Scored[]): number | null {
  const positives = scores.filter((score) => score.positive).map((score) => score.p);
  return positives.length === 0 ? null : Math.min(...positives);
}

/** The share of negatives at or above `threshold`; 0 with no negative. */
export function falsePositiveRate(scores: readonly Scored[], threshold: number): number {
  const negatives = scores.filter((score) => !score.positive);
  if (negatives.length === 0) return 0;
  return negatives.filter((score) => score.p >= threshold).length / negatives.length;
}

/** The positives below `threshold`: what the screen would miss there. */
export function missesAt(scores: readonly Scored[], threshold: number): Scored[] {
  return scores.filter((score) => score.positive && score.p < threshold);
}

/**
 * The share of rows whose top intent is the expected one, and how many wrong ones are confident enough
 * (`p` at or above `actAt`) for the companion to act on them.
 */
export function intentAccuracy(
  rows: readonly { expected: Intent; got: Intent; p: number }[],
  actAt: number,
): { accuracy: number; actedWrong: number } {
  if (rows.length === 0) return { accuracy: 0, actedWrong: 0 };
  const right = rows.filter((row) => row.got === row.expected).length;
  const actedWrong = rows.filter((row) => row.got !== row.expected && row.p >= actAt).length;
  return { accuracy: right / rows.length, actedWrong };
}

const LOCALES = ['en', 'es', 'pt', 'all'] as const;
const LAYERS = ['jev', 'claude'] as const;

const oneOf = <T extends string>(options: readonly T[], value: string, name: string): T => {
  const found = options.find((option) => option === value);
  if (found === undefined) throw new UsageError(`--${name} must be one of ${options.join(', ')}.\n${USAGE}`);
  return found;
};

function parse(argv: readonly string[]) {
  try {
    return parseArgs({ args: [...argv], options: { locale: { type: 'string' }, layer: { type: 'string' } }, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  }
}

/** The arguments after `pnpm calibrate`; throws a `UsageError` for anything else. */
export function parseCalibrateArgs(argv: readonly string[]): CalibrateArgs {
  const parsed = parse(argv);
  const [command, ...extra] = parsed.positionals;
  if (command !== 'eval' || extra.length > 0) throw new UsageError(USAGE);
  return {
    command,
    locale: oneOf(LOCALES, parsed.values.locale ?? 'all', 'locale'),
    layer: oneOf(LAYERS, parsed.values.layer ?? 'jev', 'layer'),
  };
}
