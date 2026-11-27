// The companion conversation: red flags checked on the phone first, one request at a time, every outcome stored in
// the chat on this phone, and drafts confirmed into records in one transaction (docs/app.md#companion-srccompanion).
import { randomUUID } from 'expo-crypto';
import * as Network from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';
import { currentUserId } from '../auth/currentUser';
import { localDateIn } from '../condition';
import { useI18n } from '../i18n';
import { kvGet, kvSet } from '../lib/kv';
import { deviceTimeZone } from '../lib/localDate';
import { localDb } from '../lib/local/db';
import { useOnResume } from '../lib/useOnResume';
import { showUrgentCare } from '../redflags/urgentCare';
import { excerptOf, useRedFlagCheck } from '../redflags/useRedFlagCheck';
import { applyDraft } from './applyDraft';
import { appendMessage, readChat, readMessage, updateMessage, useChat } from './chatStore';
import type { ChatMessage, ChatPayload } from './chatStore';
import { askCompanion, historyForRequest } from './companionClient';
import type { CompanionOutcome } from './companionClient';
import type { ClientQuotaKind, CompanionRequest, CompanionResponse, Draft, Mode } from './contract';

export type CompanionState = 'ready' | 'offline' | 'unavailable' | 'over_quota';

export interface Companion {
  messages: readonly ChatMessage[];
  typing: boolean;
  state: CompanionState;
  /** The mic is off for today; typing still works. */
  dictationOver: boolean;
  /** The stored message's id (it may be left unsent: offline, busy or refused); null when nothing was stored or a red flag stopped it. */
  send: (text: string, input: 'text' | 'voice') => Promise<number | null>;
  retry: (messageId: number) => Promise<void>;
  /** `'invalid'`: a store refused the draft, and nothing was written or stamped. */
  confirm: (messageId: number, draftRef: string) => 'ok' | 'invalid';
}

/** The device's calendar day, read from its zone at each call so a trip or midnight moves it: the day quotas count on. */
export function companionDay(): string {
  return localDateIn(new Date(), deviceTimeZone());
}

const quotaKey = (kind: ClientQuotaKind, userId: string, day: string): string => `companion.quota.${kind}.${userId}.${day}`;

/** The limit a 429 reported for `kind` today, or null. kv `companion.quota.<kind>.<userId>.<localDate>`. */
export function overQuotaToday(userId: string, day: string, kind: ClientQuotaKind): number | null {
  const limit = Number(kvGet(quotaKey(kind, userId, day)));
  return Number.isInteger(limit) && limit > 0 ? limit : null;
}

/**
 * The message whose request is in flight, app-wide: a message sent meanwhile (a double tap, a second screen) waits as
 * unsent with Retry rather than spending a second unit or answering out of order.
 */
let inFlight: number | null = null;

function payloadOf(result: CompanionResponse): ChatPayload {
  return { drafts: result.drafts, evidence: result.evidence, guard: result.guard, replaced: result.replaced, confirmed: {} };
}

/**
 * Stores the answer to user message `id`: the user's status and the assistant's line change together. `urgent` is a
 * red-flag answer whose flag keys this version may not know (`unchecked`), so its list can be empty.
 */
function storeAnswer(userId: string, id: number, mode: Mode, result: CompanionResponse, urgent = result.redFlags.length > 0): void {
  // Another account since (a switch while the request was out), or the chat purged by a sign-out: the answer, and any
  // urgent-care screen with the asker's words, belongs to no one here now.
  const asked = currentUserId() === userId ? readMessage(userId, id) : null;
  if (asked === null) return;
  // The question's input, not the request's: a dictated message retried as text was still spoken.
  const assistant = { role: 'assistant' as const, input: asked.input, createdAt: Date.now(), mode };
  if (urgent) {
    showUrgentCare({ flags: result.redFlags, excerpt: excerptOf(asked.text), source: asked.input, episodeId: null });
  }
  localDb().withTransactionSync(() => {
    if (urgent) {
      updateMessage(userId, id, { status: 'red_flag' });
      appendMessage(userId, { ...assistant, text: '', template: 'redflag_after', status: 'red_flag', payload: null });
    } else if (result.guard === 'replaced') {
      // The question goes too: sent again, it would only be replaced again.
      updateMessage(userId, id, { status: 'replaced' });
      appendMessage(userId, { ...assistant, text: '', template: null, status: 'replaced', payload: payloadOf(result) });
    } else {
      updateMessage(userId, id, { status: 'answered' });
      appendMessage(userId, { ...assistant, text: result.reply ?? '', template: null, status: 'answered', payload: payloadOf(result) });
    }
  });
}

/** Replaces one unconfirmed draft in a message's payload (the Edit sheet); a confirmed one stays as it was saved. */
export function replaceDraft(userId: string, messageId: number, draft: Draft): void {
  localDb().withTransactionSync(() => {
    const payload = readMessage(userId, messageId)?.payload;
    if (payload == null || Object.hasOwn(payload.confirmed, draft.ref)) return;
    updateMessage(userId, messageId, { payload: { ...payload, drafts: payload.drafts.map((item) => (item.ref === draft.ref ? draft : item)) } });
  });
}

export function useCompanion(mode: Mode, options: { episodeId?: string } = {}): Companion {
  const { userId, refreshProfile } = useAuth();
  const { locale } = useI18n();
  const user = userId ?? '';
  const messages = useChat(user);
  const check = useRedFlagCheck();
  const network = Network.useNetworkState();
  const [typing, setTyping] = useState(false);
  const [down, setDown] = useState(false);
  // Re-renders after a quota is stored in kv, which no hook watches.
  const [, setQuotaSeen] = useState(0);
  const mounted = useRef(true);
  const { episodeId } = options;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A message still marked sent with nothing in flight lost its request when the app died: it shows as not sent.
  useEffect(() => {
    if (user === '') return;
    for (const message of readChat(user)) {
      if (message.status === 'sent' && message.id !== inFlight) updateMessage(user, message.id, { status: 'unsent' });
    }
  }, [user]);

  useOnResume(() => {
    setDown(false);
  });

  const handleFailure = useCallback(
    (id: number, outcome: Extract<CompanionOutcome, { ok: false }>, day: string) => {
      updateMessage(user, id, { status: 'unsent' });
      switch (outcome.error) {
        case 'over_quota':
          kvSet(quotaKey(outcome.quota, user, day), String(outcome.limit));
          setQuotaSeen((seen) => seen + 1);
          return;
        case 'unavailable':
          setDown(true);
          return;
        case 'ai_off':
          // The profile now says the AI is off, and the tab list drops this tab.
          void refreshProfile();
          return;
        case 'network':
        case 'unknown':
          return;
      }
    },
    [user, refreshProfile],
  );

  const ask = useCallback(
    async (id: number, input: 'text' | 'voice') => {
      const chat = readChat(user);
      const message = chat.find((item) => item.id === id);
      if (message === undefined || inFlight !== null) return;
      inFlight = id;
      setTyping(true);
      const day = companionDay();
      const request: CompanionRequest = {
        mode,
        locale,
        localDate: day,
        input,
        // The asked message goes last even on a retry, as the function wants the user's turn at the end.
        messages: historyForRequest([...chat.filter((item) => item.id !== id), message]),
        ...(episodeId === undefined ? {} : { episodeId }),
      };
      let outcome: CompanionOutcome;
      try {
        outcome = await askCompanion(request);
      } finally {
        inFlight = null;
        if (mounted.current) setTyping(false);
      }
      // Stored even when the screen has gone: the answer belongs to the chat, not to this visit.
      if (outcome.ok) {
        storeAnswer(user, id, mode, outcome.result, outcome.unchecked === true || outcome.result.redFlags.length > 0);
        if (mounted.current) setDown(false);
      } else {
        handleFailure(id, outcome, day);
      }
    },
    [user, mode, locale, episodeId, handleFailure],
  );

  const send = useCallback(
    async (text: string, input: 'text' | 'voice') => {
      const trimmed = text.trim();
      if (user === '' || trimmed === '') return null;
      const message = { role: 'user' as const, input, text: trimmed, template: null, createdAt: Date.now(), mode, payload: null };
      // First, whatever else is going on; a hit opens urgent care and nothing is sent.
      if (check(trimmed, input)) {
        appendMessage(user, { ...message, status: 'red_flag' });
        return null;
      }
      // Busy or used up: the words are kept with Retry, never dropped.
      const waits = inFlight !== null || overQuotaToday(user, companionDay(), 'companion') !== null;
      const id = appendMessage(user, { ...message, status: waits ? 'unsent' : 'sent' });
      if (!waits) await ask(id, input);
      return id;
    },
    [user, mode, check, ask],
  );

  const retry = useCallback(
    async (messageId: number) => {
      const message = readMessage(user, messageId);
      if (message?.role !== 'user' || message.status !== 'unsent' || inFlight !== null) return;
      const day = companionDay();
      if (overQuotaToday(user, day, 'companion') !== null) return;
      updateMessage(user, messageId, { status: 'sent' });
      // As it was sent, unless dictation is used up today: the words are already text, so typing's unit is enough.
      await ask(messageId, message.input === 'voice' && overQuotaToday(user, day, 'dictation') === null ? 'voice' : 'text');
    },
    [user, ask],
  );

  const confirm = useCallback(
    (messageId: number, draftRef: string): 'ok' | 'invalid' => {
      try {
        // The stamp and the records in one transaction: a kill or a RangeError leaves neither without the other.
        localDb().withTransactionSync(() => {
          const message = readMessage(user, messageId);
          const payload = message?.payload;
          if (message === null || payload == null || Object.hasOwn(payload.confirmed, draftRef)) return;
          const draft = payload.drafts.find((item) => item.ref === draftRef);
          if (draft === undefined) return;
          const recordId = randomUUID();
          const doseIds = draft.kind === 'episode' ? draft.doses.map(() => randomUUID()) : [];
          updateMessage(user, messageId, { payload: { ...payload, confirmed: { ...payload.confirmed, [draftRef]: recordId } } });
          applyDraft(user, draft, { recordId, doseIds }, message.input === 'voice' ? 'voice' : 'chat');
        });
        return 'ok';
      } catch {
        // A store refused it (a time out of range, an end before the start, an open attack already there).
        return 'invalid';
      }
    },
    [user],
  );

  const day = companionDay();
  const offline = network.isConnected === false || network.isInternetReachable === false;
  const overQuota = user !== '' && overQuotaToday(user, day, 'companion') !== null;
  const state: CompanionState = offline ? 'offline' : overQuota ? 'over_quota' : down ? 'unavailable' : 'ready';
  const dictationOver = user !== '' && overQuotaToday(user, day, 'dictation') !== null;

  return { messages, typing, state, dictationOver, send, retry, confirm };
}
