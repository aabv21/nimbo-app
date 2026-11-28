/** @jest-environment node */
// The insight and signal fixtures assume exactly the pack's values, so a drift fails here first.
import { packs } from '../condition/index.ts';
import { readCases } from './cases.ts';

const pack = packs.migraine;
const insights = readCases<{ id: string }>('insights-cases.json');
const signals = readCases<{ id: string }>('signals-cases.json');

test.each([
  ['insights-cases.json', insights.cases, 14],
  ['signals-cases.json', signals.cases, 17],
])('%s has its cases, with unique ids', (_name, cases, count) => {
  expect(cases).toHaveLength(count);
  expect(new Set(cases.map((item) => item.id)).size).toBe(count);
});

test("insights-cases.json's pack is the pack's slice", () => {
  expect(insights.pack).toEqual({
    sleepBandHours: pack.sleepBandHours,
    dayStartHour: pack.dayStartHour,
    insights: pack.insights,
  });
});

test("signals-cases.json's pack matches the pack's slice, overuse under the pack's names", () => {
  expect(signals.pack).toEqual({
    sleepBandHours: pack.sleepBandHours,
    dayStartHour: pack.dayStartHour,
    signals: pack.signals,
    push: pack.push,
    overuse: {
      limits: pack.overuseDayLimits,
      warnRatio: pack.overuseWarnRatio,
      combinedLimit: pack.combinedClassDayLimit,
    },
  });
});
