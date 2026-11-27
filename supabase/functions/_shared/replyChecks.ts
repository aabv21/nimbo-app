// The reply screen's offline checks, which run on every reply and alone decide when Jev and Haiku are
// both down: dose amounts outside a verbatim cabinet quote, numbers no tool result or user message holds, take advice.

import type { GuardKey } from './companion/contract.ts';
import { normalizeText } from './condition/index.ts';
import { isRecord } from './guards.ts';
import type { ReplyContext } from './screen.ts';

/** One tool call of this request and the JSON its result returned to the model. */
export type ToolResultRecord = { tool: string; result: unknown };

// The saved fields' limits; a longer text did not come from the cabinet.
const NAME_MAX = 80;
const DOSE_TEXT_MAX = 120;

// The dose patterns run on `doseText` output: normalizeText (lower case, accents folded so `c[aá]psulas` meets
// `capsulas`, words split by single spaces) after a decimal's separator became `d`, so "2.5" stays one token.
const NUM = '\\d+(?:d\\d+)?';
const NUMBER_WORDS =
  'two|three|four|five|six|seven|eight|nine|ten|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|dois|duas|quatro|sete|oito|nove|dez';
const COUNT = `(?:${NUM}|${NUMBER_WORDS})`;
// "4 6" is "4-6" after normalizing.
const RANGE = `${COUNT}(?: (?:a |to |or |o |ou )?${COUNT})?`;
const HALF = '(?:half|medio|media|meio|meia)(?: a| an)?';
const DOSE_UNITS =
  'mg|mcg|µg|g|ml|ui|iu|units?|unidades?|gotas|drops|comprimidos?|tabletas?|pastillas?|c[aá]psulas?|tablets?|pills?|capsules?|sachets?|sobres?|puffs?|jatos?|' +
  'milligrams?|miligramos?|miligramas?|tabs?|caps?';
const HOURS = '(?:h|hrs?|hours?|horas?)';
// The alternatives: an amount, an interval, then pt "de 6 em 6 horas" and "6/6h".
const DOSE = new RegExp(
  `(?:^| )((?:${RANGE}|${HALF}) ?(?:${DOSE_UNITS})|(?:a cada|every|cada) ${RANGE} ?${HOURS}|de (?<every>${COUNT}) em \\k<every> ?(?:h|horas?)|(?<slash>${NUM}) \\k<slash> ?(?:h|horas?))(?= |$)`,
  'g',
);
// `\d+([.,]\d+)?` written without a nested quantifier: digits, then at most one separator followed by digits.
const NUMBER = /\d+(?:[.,]\d)?\d*/g;

// Imperatives and count words of the take-advice check, normalized ("tómate" is `tomate`).
const IMPERATIVES = ['take', 'repeat', 'double', 'skip', 'toma', 'tomate', 'tome', 'tomar', 'tomalo', 'tomala', 'repite', 'repetir', 'repita'];
const COUNT_WORDS = ['one', 'uno', 'una', 'um', 'uma', 'two', 'dos', 'dois', 'duas'];

const joinDecimals = (text: string): string => text.replace(/(\d)[.,](\d)/g, '$1d$2');
const doseText = (text: string): string => normalizeText(joinDecimals(text));
const hasWord = (padded: string, word: string): boolean => padded.includes(` ${word} `);

function doseSpans(normalized: string): { start: number; end: number; amount: string }[] {
  return [...normalized.matchAll(DOSE)].map((match) => {
    const amount = match[1] ?? '';
    const start = match.index + match[0].length - amount.length;
    return { start, end: start + amount.length, amount };
  });
}

/** Every dose amount ("400 mg", "two tablets", "2.5 mg") or dosing interval ("every 4-6 hours", "de 6 em 6 horas"), normalized. */
export function doseAmounts(text: string): string[] {
  return doseSpans(doseText(text)).map((span) => span.amount.replace(/(\d)d(\d)/g, '$1.$2'));
}

/** The normalized names and dose texts of this request's `get_cabinet` results, longest first. */
function cabinetTexts(toolResults: readonly ToolResultRecord[]): string[] {
  const texts = new Set<string>();
  for (const { tool, result } of toolResults) {
    if (tool !== 'get_cabinet' || !isRecord(result) || !Array.isArray(result.medications)) continue;
    for (const medication of result.medications as unknown[]) {
      if (!isRecord(medication)) continue;
      const { name, dose_text: saved } = medication;
      if (typeof name === 'string' && name.length <= NAME_MAX) texts.add(doseText(name));
      if (typeof saved === 'string' && saved.length <= DOSE_TEXT_MAX) texts.add(doseText(saved));
    }
  }
  texts.delete('');
  return [...texts].sort((a, b) => b.length - a.length);
}

/** The medications of this request's `get_crisis_plan` results (by `name`, or `key` in the fixtures), normalized. */
function planMedications(toolResults: readonly ToolResultRecord[]): string[] {
  return toolResults.flatMap(({ tool, result }) =>
    tool === 'get_crisis_plan' && isRecord(result) && Array.isArray(result.plan)
      ? (result.plan as unknown[]).flatMap((entry) => {
          if (!isRecord(entry) || entry.kind !== 'medication') return [];
          const name = typeof entry.name === 'string' ? entry.name : entry.key;
          return typeof name === 'string' ? [doseText(name)] : [];
        })
      : [],
  );
}

/**
 * The reply, normalized, with every whole-word occurrence of a `get_cabinet` name or dose text blanked:
 * a verbatim quote of the user's own entry is not dose advice. An occurrence is kept when a dose amount
 * runs across its edge, so a saved "400" cannot hide "take 400 mg" and a saved "5 mg" cannot hide "2.5 mg".
 */
export function maskCabinetText(reply: string, toolResults: readonly ToolResultRecord[]): string {
  const text = doseText(reply);
  const padded = ` ${text} `;
  const doses = doseSpans(text);
  let masked = text;
  for (const quote of cabinetTexts(toolResults)) {
    // In `padded`, the match of ` ${quote} ` starts one before the quote, which is the quote's index in `text`.
    for (let start = padded.indexOf(` ${quote} `); start !== -1; start = padded.indexOf(` ${quote} `, start + 1)) {
      const end = start + quote.length;
      const straddled = doses.some((dose) => dose.start < end && dose.end > start && (dose.start < start || dose.end > end));
      if (!straddled) masked = `${masked.slice(0, start)}${' '.repeat(quote.length)}${masked.slice(end)}`;
    }
  }
  return masked;
}

// "03" is 3 and "6,5" is 6.5.
function canonical(token: string): string {
  return token.replace(',', '.').replace(/^0+(?=\d)/, '');
}

// A date or a clock time grounds nothing: its digits would otherwise ground most small numbers.
const DATE_OR_TIME = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2})/;
const LETTER = /\p{L}/u;
const MAX_DEPTH = 32;

/** The numbers a tool result states: numeric leaves, and numbers in string leaves that are not dates, times or refs ("e1"). */
function groundingNumbers(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.add(canonical(String(value)));
  } else if (typeof value === 'string') {
    if (DATE_OR_TIME.test(value.trim())) return;
    for (const match of value.matchAll(NUMBER)) {
      if (!LETTER.test(value.charAt(match.index - 1))) out.add(canonical(match[0]));
    }
  } else if (Array.isArray(value)) {
    for (const item of value as unknown[]) groundingNumbers(item, out, depth + 1);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) groundingNumbers(item, out, depth + 1);
  }
}

/**
 * The digit tokens of `reply`, once each and as written, that neither the tool results, the user's message
 * nor the context's `groundingNumbers` (a draft's clock time, which a time string cannot ground) states.
 */
export function ungroundedNumbers(reply: string, context: Pick<ReplyContext, 'toolResults' | 'userText' | 'groundingNumbers'>): string[] {
  const grounded = new Set<string>();
  for (const { result } of context.toolResults) groundingNumbers(result, grounded);
  for (const [token] of context.userText.matchAll(NUMBER)) grounded.add(canonical(token));
  for (const token of context.groundingNumbers ?? []) grounded.add(canonical(token));
  const seen = new Set<string>();
  const ungrounded: string[] = [];
  for (const [token] of reply.matchAll(NUMBER)) {
    const value = canonical(token);
    if (grounded.has(value) || seen.has(value)) continue;
    seen.add(value);
    ungrounded.push(token);
  }
  return ungrounded;
}

/** A sentence with a take imperative ("take", "tómate", "pode tomar") and a dose target: a medicine, an amount or a count. */
function hasTakeAdvice(reply: string, toolResults: readonly ToolResultRecord[]): boolean {
  const targets = [...cabinetTexts(toolResults), ...planMedications(toolResults), ...COUNT_WORDS];
  return joinDecimals(reply)
    .split(/[.!?;¡¿\n]+/)
    .map((sentence) => ` ${normalizeText(sentence)} `)
    .some(
      (padded) =>
        IMPERATIVES.some((word) => hasWord(padded, word)) &&
        (doseSpans(padded.trim()).length > 0 || targets.some((target) => target !== '' && hasWord(padded, target))),
    );
}

/**
 * `violated` holds `dose_advice` when a dose amount is left after masking the cabinet quotes. `ungrounded`
 * feeds the models; it and `takeAdvice` decide on their own only when both models are down.
 */
export function localReplyChecks(reply: string, context: ReplyContext): { violated: GuardKey[]; ungrounded: string[]; takeAdvice: boolean } {
  const violated: GuardKey[] = doseAmounts(maskCabinetText(reply, context.toolResults)).length > 0 ? ['dose_advice'] : [];
  return { violated, ungrounded: ungroundedNumbers(reply, context), takeAdvice: hasTakeAdvice(reply, context.toolResults) };
}
