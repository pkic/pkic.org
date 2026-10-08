import { z } from "zod";
import { databaseIdSchema } from "../../shared/schemas/identifiers";
import { utcInstantSchema } from "../../shared/schemas/api-common";

const sessionReferenceSchema = z.object({ sessionId: databaseIdSchema, operatorUserId: databaseIdSchema }).strict();
const intentSchema = sessionReferenceSchema
  .extend({ intentId: z.uuid(), requestedAt: utcInstantSchema, expiresAt: utcInstantSchema })
  .strict();
const stateSchema = z
  .object({
    active: sessionReferenceSchema.nullable(),
    pending: intentSchema.nullable(),
    blockedSessions: z.array(z.object({ sessionId: databaseIdSchema, expiresAt: utcInstantSchema }).strict()).max(256),
  })
  .strict();
type SessionReference = z.infer<typeof sessionReferenceSchema>;
export type PendingUserLogout = z.infer<typeof intentSchema>;
type SessionState = z.infer<typeof stateSchema>;
export const USER_SESSION_STATE_CHANGED = "pkic-user-session-state-changed";
const STORE = "state";
const KEY = "current";
const emptyState = (): SessionState => ({ active: null, pending: null, blockedSessions: [] });

function openStorage(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pkic-user-session-state", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local sign-out storage is unavailable"));
    request.onblocked = () => reject(new Error("Local sign-out storage is blocked"));
  });
}

async function access<T>(change: (state: SessionState) => T, write = false): Promise<T> {
  const db = await openStorage();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, write ? "readwrite" : "readonly");
      const store = transaction.objectStore(STORE);
      const request = store.get(KEY);
      let value: T;
      let refusal: Error | undefined;
      transaction.oncomplete = () => resolve(value);
      transaction.onerror = transaction.onabort = () =>
        reject(refusal ?? transaction.error ?? new Error("Local sign-out storage failed"));
      request.onsuccess = () => {
        try {
          const state = request.result === undefined ? emptyState() : stateSchema.parse(request.result);
          state.blockedSessions = state.blockedSessions.filter((item) => Date.parse(item.expiresAt) > Date.now());
          value = change(state);
          if (write) store.put(stateSchema.parse(state), KEY);
        } catch (error) {
          refusal = error instanceof Error ? error : new Error("Local sign-out storage failed", { cause: error });
          transaction.abort();
          reject(refusal);
        }
      };
    });
  } finally {
    db.close();
  }
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(USER_SESSION_STATE_CHANGED));
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(USER_SESSION_STATE_CHANGED);
    channel.postMessage(null);
    channel.close();
  }
}

export const readPendingUserLogout = () => access((state) => state.pending);
export const readActiveUserSession = () => access((state) => state.active);

/** Only a canonical successful session response may establish this local upload hint. */
export async function recordCanonicalSession(reference: SessionReference): Promise<boolean> {
  const parsed = sessionReferenceSchema.parse(reference);
  const recorded = await access((state) => {
    if (state.blockedSessions.some((item) => item.sessionId === parsed.sessionId)) return false;
    state.active = parsed;
    return true;
  }, true);
  if (recorded) notify();
  return recorded;
}

/** Persist before clearing rendered identity; IDs only, never a cookie or profile. */
export async function beginUserLogout(reference: SessionReference & { expiresAt: string }): Promise<PendingUserLogout> {
  const parsed = sessionReferenceSchema.parse({
    sessionId: reference.sessionId,
    operatorUserId: reference.operatorUserId,
  });
  const intent = await access((state) => {
    if (state.active && state.active.sessionId !== parsed.sessionId)
      throw new Error("Your sign-in changed. Refresh before signing out.");
    const next = intentSchema.parse({
      ...parsed,
      intentId: crypto.randomUUID(),
      requestedAt: new Date().toISOString(),
      expiresAt: reference.expiresAt,
    });
    state.pending = next;
    state.active = null;
    if (!state.blockedSessions.some((item) => item.sessionId === parsed.sessionId))
      state.blockedSessions.push({ sessionId: parsed.sessionId, expiresAt: next.expiresAt });
    return next;
  }, true);
  notify();
  return intent;
}

/** Stale completion cannot consume a later logout or remove a newer session. */
export async function settleUserLogout(intent: PendingUserLogout): Promise<boolean> {
  const settled = await access((state) => {
    if (state.pending?.intentId !== intent.intentId || state.pending.sessionId !== intent.sessionId) return false;
    state.pending = null;
    if (state.active?.sessionId === intent.sessionId) state.active = null;
    return true;
  }, true);
  if (settled) notify();
  return settled;
}

/** Storage failure is a refusal, not permission to upload or import. */
export async function scannerUploadSuspended(operatorUserId: string, sessionId?: string): Promise<boolean> {
  try {
    return await access(
      (state) =>
        !state.active ||
        state.active.operatorUserId !== operatorUserId ||
        (sessionId !== undefined && state.active.sessionId !== sessionId) ||
        state.blockedSessions.some((item) => item.sessionId === state.active?.sessionId),
    );
  } catch {
    return true;
  }
}

export function subscribeUserSessionState(callback: () => void): () => void {
  window.addEventListener(USER_SESSION_STATE_CHANGED, callback);
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(USER_SESSION_STATE_CHANGED);
  channel?.addEventListener("message", callback);
  return () => {
    window.removeEventListener(USER_SESSION_STATE_CHANGED, callback);
    channel?.close();
  };
}
