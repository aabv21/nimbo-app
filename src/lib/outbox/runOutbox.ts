// Sends a user's queued writes one at a time, in order, with backoff: docs/app.md, "Local store, outbox and sync".
import type { Client } from '../../auth/emailAuth';
import { classifyRpcError } from './errors';
import type { SendResult } from './errors';
import { completeOp, listOutbox, saveAttempt } from './outbox';
import type { OutboxOp } from './outbox';

export type { SendResult };

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 8;

/** `min(5 s · 2^(attempts − 1), 10 min)`, attempts counted from 1 (no-answer sends included). */
export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export interface OutboxDeps {
  send(op: OutboxOp): Promise<SendResult>;
  /** The account the client would send as right now; an operation of anyone else waits. */
  sessionUserId(): string | null;
  now?: () => number;
}

export interface RunOutboxResult {
  sent: number;
  failed: number;
  /** Operations still queued and not failed: in backoff, behind one that is, or held by a pause or another session. */
  waiting: number;
}

/** The RPC call for an operation, classified. A call that throws instead of answering is retryable. */
export function rpcSender(client: Client): (op: OutboxOp) => Promise<SendResult> {
  return async (op) => {
    try {
      // `args` was typed by `enqueue` as `OutboxArgs<kind>` and stored as JSON.
      const { error, status } = await client.rpc(op.kind, op.args as never);
      return classifyRpcError(error, status);
    } catch (error) {
      return thrownResult(error);
    }
  };
}

/** A fetch that threw (React Native's "Network request failed") got no answer; anything else is a fault. */
function thrownResult(error: unknown): SendResult {
  return error instanceof TypeError ? { ok: false, permanent: false, noResponse: true } : { ok: false, permanent: false };
}

const inFlight = new Map<string, Promise<RunOutboxResult>>();
/** A call made mid-pass sweeps again once the pass ends, so an operation queued meanwhile is not left behind. */
const rerunRequested = new Set<string>();
const paused = new Set<string>();

/** Resolves once a running pass has stopped: a send in flight finishes, nothing after it starts. */
export async function pauseOutbox(userId: string): Promise<void> {
  paused.add(userId);
  await inFlight.get(userId)?.catch(() => undefined);
}

export function resumeOutbox(userId: string): void {
  paused.delete(userId);
}

export function runOutbox(userId: string, deps: OutboxDeps): Promise<RunOutboxResult> {
  const existing = inFlight.get(userId);
  if (existing !== undefined) {
    rerunRequested.add(userId);
    return existing;
  }
  const pass = runPasses(userId, deps).finally(() => {
    inFlight.delete(userId);
  });
  inFlight.set(userId, pass);
  return pass;
}

async function runPasses(userId: string, deps: OutboxDeps): Promise<RunOutboxResult> {
  let sent = 0;
  let result: RunOutboxResult;
  for (;;) {
    rerunRequested.delete(userId);
    result = await runPass(userId, deps);
    sent += result.sent;
    if (!rerunRequested.has(userId) || paused.has(userId)) break;
  }
  // `failed` and `waiting` describe the queue as the last sweep left it.
  return { ...result, sent };
}

async function runPass(userId: string, deps: OutboxDeps): Promise<RunOutboxResult> {
  const now = deps.now ?? Date.now;
  const ops = listOutbox(userId);
  let sent = 0;
  let failed = 0;
  let stoppedAt = ops.length;

  for (const [position, op] of ops.entries()) {
    if (op.failed) {
      failed += 1;
      continue;
    }
    // Strict order: an operation waiting out its backoff holds back every one after it.
    if (op.nextAttemptAt > now() || paused.has(userId) || deps.sessionUserId() !== userId) {
      stoppedAt = position;
      break;
    }
    // Only a killed run leaves an operation at the limit without `failed`: give up instead of a ninth send.
    if (op.attempts >= MAX_ATTEMPTS) {
      saveAttempt({ ...op, failed: true });
      failed += 1;
      continue;
    }

    // Claimed before the send: a kill never reaches the code below, and the next launch must count it.
    // The wait grows with every send, answered or not.
    const attempts = op.attempts + 1;
    const claimed: OutboxOp = { ...op, attempts, nextAttemptAt: now() + backoffMs(attempts + op.noResponses) };
    saveAttempt(claimed);

    let outcome: SendResult;
    try {
      outcome = await deps.send(claimed);
    } catch (error) {
      outcome = thrownResult(error);
    }

    if (!outcome.ok && outcome.noResponse === true) {
      // Offline is not the server refusing: the attempt is given back, so hours offline never fail an
      // operation, and the queue waits out the backoff (or a reconnect) in order.
      saveAttempt({ ...claimed, attempts: op.attempts, noResponses: op.noResponses + 1 });
      stoppedAt = position;
      break;
    }
    if (outcome.ok) {
      completeOp(claimed);
      sent += 1;
    } else if (outcome.permanent || attempts >= MAX_ATTEMPTS) {
      saveAttempt({ ...claimed, failed: true });
      failed += 1;
    } else {
      // Retryable: the claim already holds its backoff, and nothing after it may go first.
      stoppedAt = position;
      break;
    }
  }

  const rest = ops.slice(stoppedAt);
  const waiting = rest.filter((op) => !op.failed).length;
  // Failed operations past the stop are still failed; the banner counts them too.
  return { sent, failed: failed + rest.length - waiting, waiting };
}
