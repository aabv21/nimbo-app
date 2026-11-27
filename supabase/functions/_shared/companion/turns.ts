// The companion's turns in and its reply out: reading a Messages API answer, cleaning the final text and
// turning its `[ref]` markers into evidence (docs/architecture.md#the-companion).

import { isRecord } from '../guards.ts';
import { type Evidence, TURN_MAX_CHARS } from './contract.ts';
import type { Refs } from './refs.ts';

export { parseTurns, type Turn } from './contract.ts';

export type ToolCall = { id: string; name: string; input: unknown };

/** `truncated`: the reply stopped at `max_tokens`, so only its complete sentences are kept. */
export type Step =
  | { kind: 'reply'; text: string; truncated: boolean }
  | { kind: 'tools'; content: unknown[]; calls: ToolCall[] }
  | { kind: 'refusal' }
  | { kind: 'failed' };

/**
 * One Messages API answer, read by block type: the text blocks of this (final) call, the tool calls to run
 * with the content to send back unchanged, a refusal, or failed. Text between tool calls never reaches the reply.
 */
export function parseStep(body: unknown): Step {
  if (!isRecord(body)) return { kind: 'failed' };
  if (body.stop_reason === 'refusal') return { kind: 'refusal' };
  if (!Array.isArray(body.content)) return { kind: 'failed' };
  const content = body.content as unknown[];
  if (body.stop_reason === 'tool_use') {
    const calls = content.flatMap((block): ToolCall[] =>
      isRecord(block) && block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string'
        ? [{ id: block.id, name: block.name, input: block.input }]
        : [],
    );
    return calls.length === 0 ? { kind: 'failed' } : { kind: 'tools', content, calls };
  }
  // A max_tokens stop may have cut a tool call mid-input: never run it.
  if (content.some((block) => isRecord(block) && block.type === 'tool_use')) return { kind: 'failed' };
  const text = content
    .flatMap((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join(' ')
    .trim();
  return text === '' ? { kind: 'failed' } : { kind: 'reply', text, truncated: body.stop_reason === 'max_tokens' };
}

const UUID_ANYWHERE = /[([]?\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*[)\]]?/gi;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;

/** C0 and C1 controls, zero-width and bidi marks: they would hide or reorder text in the app. */
function invisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** Plain text for the app: no ids, links, Markdown markers or control characters, at most 500 characters cut at a word. */
export function sanitizeReply(text: string): string {
  const clean = Array.from(text, (char) => (invisible(char.codePointAt(0) ?? 0) ? ' ' : char))
    .join('')
    .replace(UUID_ANYWHERE, ' ')
    .replace(LINK, ' ')
    .replace(/[*`#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  const chars = Array.from(clean);
  if (chars.length <= TURN_MAX_CHARS) return clean;
  const cut = chars.slice(0, TURN_MAX_CHARS - 1).join('');
  const atWord = cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).replace(/[\s.,;:!?]+$/, '');
  return `${atWord}…`;
}

const SENTENCE_END = /[.!?…](?=\s|$)/g;

/** `text` up to its last sentence end (`.`, `!`, `?` or `…` before a space or the end); empty when there is none. */
export function completeSentences(text: string): string {
  const trimmed = text.trim();
  let end = -1;
  for (const match of trimmed.matchAll(SENTENCE_END)) end = match.index;
  return end === -1 ? '' : trimmed.slice(0, end + 1);
}

/** The first `n` sentences of `text`, or all of it when it has fewer. */
export function firstSentences(text: string, n: number): string {
  const trimmed = text.trim();
  let seen = 0;
  for (const match of trimmed.matchAll(SENTENCE_END)) {
    seen += 1;
    if (seen === n) return trimmed.slice(0, match.index + 1);
  }
  return trimmed;
}

// A short bracketed token: the refs the prompt asks for, and anything else that looks like one.
const MARKER = /\s*\[([^\]\s]{1,16})\]/g;

/**
 * The text without its `[ref]` markers, and the evidence of each cited ref this request minted, once each
 * in citation order. A marker for anything else (an invented ref, a replayed one) is dropped with no evidence.
 */
export function extractCitations(text: string, refs: Pick<Refs, 'idOf'>, evidenceOf: (ref: string) => Evidence | null): { text: string; evidence: Evidence[] } {
  const evidence = new Map<string, Evidence>();
  for (const match of text.matchAll(MARKER)) {
    const ref = match[1] ?? '';
    const item = refs.idOf(ref) === null ? null : evidenceOf(ref);
    if (item !== null && !evidence.has(ref)) evidence.set(ref, item);
  }
  const stripped = text.replace(MARKER, '').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
  return { text: stripped, evidence: [...evidence.values()] };
}
