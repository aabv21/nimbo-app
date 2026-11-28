// Loads the calibration fixtures in `calibration/` for the guard tests (docs/testing.md#calibration-fixtures).
import { readFileSync } from 'node:fs';

import type { Locale } from '../condition/index.ts';

export const locales: readonly Locale[] = ['en', 'es', 'pt'];

export type ReplyFixture = {
  id: string;
  reply: string;
  toolResults?: { tool: string; result: unknown }[];
  expected: { safe: boolean; violated: string[] };
};

export type IntentFixture = { id: string; text: string; expected: { intent: string } };

function read(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../../../calibration/${name}`, import.meta.url), 'utf8')) as unknown;
}

export const replyFixtures = (locale: Locale): ReplyFixture[] => read(`unsafe-replies.${locale}.json`) as ReplyFixture[];

export const intentFixtures = (locale: Locale): IntentFixture[] => read(`intents.${locale}.json`) as IntentFixture[];

export const replyFixture = (id: string): ReplyFixture => {
  const locale = id.slice(0, 2) as Locale;
  const found = replyFixtures(locale).find((fixture) => fixture.id === id);
  if (found === undefined) throw new Error(`no reply fixture ${id}`);
  return found;
};
