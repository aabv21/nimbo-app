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
// A Markdown link or image keeps only its text. Then a scheme or `www.` goes to the end of its run of non-spaces wherever
// it starts, with no word boundary, so a glued prefix ("Saved:https://…", "x_www.…") stays and the link goes; the bounded
// scheme keeps each start's scan short.
const MARKDOWN_LINK = /!?\[([^\]]*)\]\([^)]*\)/g;
const LINK = /[a-z][a-z0-9+.-]{0,31}:\/\/\S*|www\.\S*/gi;
// A bare domain: letters, digits, dots and hyphens ending in a top-level domain from this list. A dose abbreviation
// ("cp.dia/noite", "mg.kg/dia") ends in no listed one; the list leaves out units that are also country codes (kg, mg, ml).
const HOST = /^[a-z0-9.-]+\.([a-z]{2,24})$/i;
const TOP_LEVEL = new Set([
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'app', 'dev', 'ai', 'xyz', 'site', 'online', 'link', 'click', 'top',
  'shop', 'store', 'live', 'lol', 'example', 'ly', 'gl', 'to', 'gg', 'tk', 'cc', 'tv', 'us', 'uk', 'eu', 'de', 'fr', 'it',
  'ru', 'cn', 'in', 'br', 'es', 'mx', 'ar', 'cl', 'pe', 'uy', 've', 'ec', 'bo', 'py', 'pt',
]);

/**
 * A bare domain followed by a path, a query or a fragment (`evil.example/c`, `evil.example?d=…`): its top-level domain
 * is listed, or a query (`=`, `%`) follows it. Anything with a scheme or `www.` is already gone (`LINK`).
 */
function isBareLink(word: string): boolean {
  const bare = word.replace(/^[^a-z0-9]+/i, '');
  const cut = bare.search(/[/?#]/);
  if (cut <= 0) return false;
  const tld = HOST.exec(bare.slice(0, cut))?.[1]?.toLowerCase();
  if (tld === undefined) return false;
  return TOP_LEVEL.has(tld) || /[=%]/.test(bare.slice(cut));
}

/** C0 and C1 controls, zero-width and bidi marks, and line separators: they would hide, reorder or fake a line of text. */
function invisible(code: number): boolean {
  return (
    code <= 0x1f ||
    (code >= 0x7f && code <= 0x9f) ||
    (code >= 0x200b && code <= 0x200f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/** `text` with every invisible character as a space: for a reply and for a note alike. */
export function spaceInvisible(text: string): string {
  return Array.from(text, (char) => (invisible(char.codePointAt(0) ?? 0) ? ' ' : char)).join('');
}

/** Plain text for the app: no ids, links, Markdown markers or control characters, at most 500 characters cut at a word. */
export function sanitizeReply(text: string): string {
  const clean = spaceInvisible(text)
    .replace(UUID_ANYWHERE, ' ')
    .replace(MARKDOWN_LINK, '$1')
    .replace(LINK, ' ')
    .split(/(\s+)/)
    .map((word) => (isBareLink(word) ? ' ' : word))
    .join('')
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
