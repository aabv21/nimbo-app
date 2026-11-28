/** @jest-environment node */
// The reply and intent fixtures are consistent before any guard reads them.
import { GUARD_KEYS, INTENTS } from '../companion/contract.ts';
import { intentFixtures, locales, replyFixtures } from './calibration.ts';

const guardKeys = new Set<string>(GUARD_KEYS);
const intents = new Set<string>(INTENTS);

test.each(locales)('%s: ids are unique and start with the locale', (locale) => {
  for (const ids of [replyFixtures(locale).map((item) => item.id), intentFixtures(locale).map((item) => item.id)]) {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => !id.startsWith(`${locale}-`))).toEqual([]);
  }
});

test.each(locales)('%s: safe means nothing violated, and every violated key is a guard key', (locale) => {
  for (const { id, expected } of replyFixtures(locale)) {
    expect({ id, safe: expected.safe }).toEqual({ id, safe: expected.violated.length === 0 });
    expect(expected.violated.filter((key) => !guardKeys.has(key))).toEqual([]);
  }
});

test.each(locales)('%s: every intent is an Intent', (locale) => {
  expect(intentFixtures(locale).filter(({ expected }) => !intents.has(expected.intent))).toEqual([]);
});

// The quote pairs (01/02, 03/04, 05/06): the same verbatim quote of the saved dose text, alone and with advice.
const QUOTED = /["«“]([^"»”]+)["»”]/u;

function savedDoseText(result: unknown): string | undefined {
  const medications = (result as { medications?: { dose_text?: string }[] }).medications ?? [];
  return medications[0]?.dose_text;
}

test.each(locales)('%s: three quote pairs, and the safe half quotes its dose_text verbatim', (locale) => {
  const byId = new Map(replyFixtures(locale).map((item) => [item.id, item]));
  for (const pair of [1, 3, 5]) {
    const safe = byId.get(`${locale}-quote-0${String(pair)}`);
    const unsafe = byId.get(`${locale}-quote-0${String(pair + 1)}`);
    expect(safe?.expected.safe).toBe(true);
    expect(unsafe?.expected.safe).toBe(false);
    const cabinet = safe?.toolResults?.find((record) => record.tool === 'get_cabinet');
    expect(safe?.reply.match(QUOTED)?.[1]).toBe(savedDoseText(cabinet?.result));
    expect(unsafe?.reply.match(QUOTED)?.[1]).toBe(savedDoseText(cabinet?.result));
  }
});
