// `companion`'s call: the answered turns that fit its limits, the body checked with `isCompanionResponse`, and each
// error mapped to what the tab shows (docs/app.md#companion-srccompanion).
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import { isRecord } from '../../supabase/functions/_shared/guards.ts';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { ChatMessage } from './chatStore';
import { isCompanionResponse, MAX_TURNS, TOTAL_MAX_CHARS, TURN_MAX_CHARS } from './contract';
import type { CompanionRequest, CompanionResponse, QuotaKind, Turn } from './contract';

type Client = SupabaseClient<Database>;

export type CompanionError = 'network' | 'over_quota' | 'unavailable' | 'ai_off' | 'unknown';

export type CompanionOutcome =
  | { ok: true; result: CompanionResponse }
  | { ok: false; error: Exclude<CompanionError, 'over_quota'> }
  | { ok: false; error: 'over_quota'; quota: QuotaKind; limit: number };

const chars = (text: string): string[] => Array.from(text);

/** A turn the model saw and answered, or the message being sent; a template line is the app's own words. */
function isTurn(message: ChatMessage): boolean {
  return message.template === null && (message.status === 'answered' || message.status === 'sent') && message.text.trim() !== '';
}

/**
 * The newest turns within the function's limits (12 turns, 500 characters each, 4,000 in all), starting with a user
 * turn. Red-flag, unsent and replaced exchanges never go back to the model.
 */
export function historyForRequest(chat: readonly ChatMessage[]): Turn[] {
  const kept: Turn[] = [];
  let total = 0;
  for (let index = chat.length - 1; index >= 0 && kept.length < MAX_TURNS; index -= 1) {
    const message = chat.at(index);
    if (message === undefined || !isTurn(message)) continue;
    const text = chars(message.text.trim()).slice(0, TURN_MAX_CHARS).join('');
    total += chars(text).length;
    if (total > TOTAL_MAX_CHARS) break;
    kept.unshift({ role: message.role, text });
  }
  while (kept[0]?.role === 'assistant') kept.shift();
  return kept;
}

async function quotaOf(response: Response): Promise<{ quota: QuotaKind; limit: number } | null> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!isRecord(body) || (body.quota !== 'companion' && body.quota !== 'dictation')) return null;
  const { limit } = body;
  return typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? { quota: body.quota, limit } : null;
}

async function failure(error: unknown): Promise<Extract<CompanionOutcome, { ok: false }>> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context instanceof Response ? error.context : null;
    switch (response?.status) {
      case 429: {
        const over = await quotaOf(response);
        return over === null ? { ok: false, error: 'unknown' } : { ok: false, error: 'over_quota', ...over };
      }
      case 403:
        return { ok: false, error: 'ai_off' };
      default:
        // A server-side failure is the companion being down; any other 4xx is a request this app got wrong.
        return { ok: false, error: response !== null && response.status >= 500 ? 'unavailable' : 'unknown' };
    }
  }
  // The gateway failed in front of the function.
  if (error instanceof FunctionsRelayError) return { ok: false, error: 'unavailable' };
  // An aborted request (the client's 45 s deadline) surfaces as a fetch error too.
  if (error instanceof FunctionsFetchError || error instanceof TypeError) return { ok: false, error: 'network' };
  return { ok: false, error: 'unknown' };
}

/** Never throws: every failure is an outcome, and a body this app version cannot check is `unknown`. */
export async function askCompanion(input: CompanionRequest, client: Client = supabase): Promise<CompanionOutcome> {
  try {
    const response = await client.functions.invoke<unknown>('companion', { body: input });
    if (response.error !== null) return await failure(response.error);
    return isCompanionResponse(response.data) ? { ok: true, result: response.data } : { ok: false, error: 'unknown' };
  } catch (error) {
    return failure(error);
  }
}
