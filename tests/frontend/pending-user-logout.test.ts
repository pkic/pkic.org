// @vitest-environment jsdom
import { captureLogoutPushCleanup } from "../../assets/ts/member-flows/portal/logout-push-cleanup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginUserLogout,
  readPendingUserLogout,
  readActiveUserSession,
  recordCanonicalSession,
  scannerUploadSuspended,
  settleUserLogout,
} from "../../assets/ts/shared/pending-user-logout";
import { finishUserLogout } from "../../assets/ts/shared/finish-user-logout";
import { userAuthLogoutResponseSchema } from "../../assets/shared/schemas/user-auth";
import { signOutPortalSession, resumePendingUserLogout } from "../../assets/ts/member-flows/portal/logout-session";
import {
  authStatus,
  clearAuth,
  portalSession,
  profile,
  savePortalSession,
} from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
const cleanup = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest", () => ({
  clearOperatorEligibilityManifests: cleanup,
}));
const A = { sessionId: "00000000-0000-4000-8000-000000000004", operatorUserId: "00000000-0000-4000-8000-000000000001" };
const A2 = { sessionId: "00000000-0000-4000-8000-000000000005", operatorUserId: A.operatorUserId };
const B = { sessionId: "00000000-0000-4000-8000-000000000006", operatorUserId: "00000000-0000-4000-8000-000000000007" };
const expiry = "2099-01-01T00:00:00.000Z";
let stored: unknown;

beforeEach(() => {
  stored = undefined;
  for (const name of ["localStorage", "sessionStorage"]) {
    const storage = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    });
  }
  clearAuth();
  localStorage.clear();
  cleanup.mockClear();
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("indexedDB", {
    open: () => {
      const opening = {
        onsuccess: null as (() => void) | null,
        result: {
          close: () => {},
          transaction: () => {
            const tx = {
              oncomplete: null as (() => void) | null,
              onabort: null as (() => void) | null,
              abort: () => tx.onabort?.(),
              objectStore: () => ({
                get: () => {
                  const request = { result: structuredClone(stored), onsuccess: null as (() => void) | null };
                  queueMicrotask(() => {
                    request.onsuccess?.();
                    tx.oncomplete?.();
                  });
                  return request;
                },
                put: (value: unknown) => {
                  stored = structuredClone(value);
                },
              }),
            };
            return tx;
          },
        },
      };
      queueMicrotask(() => opening.onsuccess?.());
      return opening;
    },
  });
});
afterEach(() => {
  clearAuth();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable exact-session local sign-out", () => {
  it("persists an IDs-only fence before local cleanup and refuses rehydrating A after reload", async () => {
    await recordCanonicalSession(A);
    const intent = await beginUserLogout({ ...A, expiresAt: expiry });
    expect(await readActiveUserSession()).toBeNull();
    expect(await readPendingUserLogout()).toEqual(intent);
    expect(await scannerUploadSuspended(A.operatorUserId, A.sessionId)).toBe(true);
    expect(await recordCanonicalSession(A)).toBe(false);
    expect(stored).toEqual({
      active: null,
      pending: intent,
      blockedSessions: [{ sessionId: A.sessionId, expiresAt: expiry }],
    });
    expect(Object.keys(intent).sort()).toEqual(["expiresAt", "intentId", "operatorUserId", "requestedAt", "sessionId"]);
  });
  it.each([A2, B])("late A completion preserves newer session %j", async (newer) => {
    await recordCanonicalSession(A);
    const intent = await beginUserLogout({ ...A, expiresAt: expiry });
    expect(await recordCanonicalSession(newer)).toBe(true);
    expect(await settleUserLogout(intent)).toBe(true);
    expect(await readActiveUserSession()).toEqual(newer);
    expect(await recordCanonicalSession(A)).toBe(false);
    expect(await scannerUploadSuspended(newer.operatorUserId, newer.sessionId)).toBe(false);
    expect(await scannerUploadSuspended(A.operatorUserId, A.sessionId)).toBe(true);
  });
  it("stale completion cannot consume a new logout intent", async () => {
    await recordCanonicalSession(A);
    const old = await beginUserLogout({ ...A, expiresAt: expiry });
    await recordCanonicalSession(B);
    const next = await beginUserLogout({ ...B, expiresAt: expiry });
    expect(await settleUserLogout(old)).toBe(false);
    expect(await readPendingUserLogout()).toEqual(next);
    expect(await readActiveUserSession()).toBeNull();
  });
  it("refuses a stale shell sign-out after B has established its session", async () => {
    await recordCanonicalSession(B);
    await expect(beginUserLogout({ ...A, expiresAt: expiry })).rejects.toThrow("sign-in changed");
    expect(await readActiveUserSession()).toEqual(B);
    expect(await readPendingUserLogout()).toBeNull();
  });
  it("distinguishes a genuine transaction abort from a changed-session refusal", async () => {
    await recordCanonicalSession(B);
    const before = structuredClone(stored);
    vi.stubGlobal("indexedDB", {
      open: () => {
        const opening = {
          onsuccess: null as (() => void) | null,
          result: {
            close: () => {},
            transaction: () => {
              const tx = {
                onabort: null as (() => void) | null,
                objectStore: () => ({ get: () => ({ onsuccess: null }) }),
              };
              queueMicrotask(() => tx.onabort?.());
              return tx;
            },
          },
        };
        queueMicrotask(() => opening.onsuccess?.());
        return opening;
      },
    });
    await expect(beginUserLogout({ ...A, expiresAt: expiry })).rejects.toThrow("Local sign-out storage failed");
    expect(stored).toEqual(before);
    expect(stored).toEqual({ active: B, pending: null, blockedSessions: [] });
  });
  it("keeps the fence on transport failure and uses the exact SID on retry", async () => {
    await recordCanonicalSession(A);
    const intent = await beginUserLogout({ ...A, expiresAt: expiry });
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(
        Response.json(userAuthLogoutResponseSchema.parse({ success: true, outcome: "session_changed" })),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(finishUserLogout(intent)).rejects.toThrow();
    expect(await readPendingUserLogout()).toEqual(intent);
    await recordCanonicalSession(B);
    expect(await finishUserLogout(intent)).toEqual({ outcome: "session_changed", settled: true });
    for (const [, init] of fetcher.mock.calls)
      expect(JSON.parse(init.body)).toEqual({ expectedSessionId: A.sessionId });
    expect(await readActiveUserSession()).toEqual(B);
  });
  it("actual offline sign-out clears local identity before any remote request", async () => {
    const session = {
      ...portalSessionFixture({ member: true }),
      sessionId: A.sessionId,
      identity: { id: A.operatorUserId, email: "a@example.test" },
    };
    await recordCanonicalSession(A);
    savePortalSession(session);
    sessionStorage.setItem("pkic_portal_return_path", "#/private");
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await signOutPortalSession(session);
    expect(authStatus.value).toBe("anonymous");
    expect(portalSession.value).toBeNull();
    expect(profile.value).toBeNull();
    expect(sessionStorage.getItem("pkic_portal_return_path")).toBeNull();
    expect(cleanup).toHaveBeenCalledWith(A.operatorUserId);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readPendingUserLogout()).toEqual(expect.objectContaining(A));
  });
  it("an unfinished A logout does not block a newer B sign-in while offline", async () => {
    await recordCanonicalSession(A);
    await beginUserLogout({ ...A, expiresAt: expiry });
    await recordCanonicalSession(B);
    const session = {
      ...portalSessionFixture({ member: true }),
      sessionId: B.sessionId,
      identity: { id: B.operatorUserId, email: "b@example.test" },
    };
    savePortalSession(session);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await resumePendingUserLogout()).toBe(false);
    expect(portalSession.value).toBe(session);
    expect(authStatus.value).toBe("authenticated");
  });
  it("never unsubscribes or forgets B's notification context after capturing A", async () => {
    await recordCanonicalSession(A);
    localStorage.setItem("pkic-browser-notification-device", "00000000-0000-4000-8000-000000000010");
    const unsubscribe = vi.fn(async () => true);
    let resolveSubscription!: (value: { unsubscribe: typeof unsubscribe }) => void;
    const subscription = new Promise<{ unsubscribe: typeof unsubscribe }>((resolve) => {
      resolveSubscription = resolve;
    });
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: async () => ({ pushManager: { getSubscription: () => subscription } }) },
    });
    const clean = captureLogoutPushCleanup(A.sessionId);
    await beginUserLogout({ ...A, expiresAt: expiry });
    await recordCanonicalSession(B);
    localStorage.setItem("pkic-browser-notification-device", "00000000-0000-4000-8000-000000000011");
    resolveSubscription({ unsubscribe });
    expect(await clean()).toBe(true);
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("pkic-browser-notification-device")).toBe("00000000-0000-4000-8000-000000000011");
  });
  it("refuses storing a 257th live block without evicting prior protection", async () => {
    stored = {
      active: A,
      pending: null,
      blockedSessions: Array.from({ length: 256 }, (_, n) => ({
        sessionId: (n + 16).toString(16).padStart(32, "0"),
        expiresAt: expiry,
      })),
    };
    await expect(beginUserLogout({ ...A, expiresAt: expiry })).rejects.toThrow();
    expect(await readPendingUserLogout()).toBeNull();
    expect(await readActiveUserSession()).toEqual(A);
    expect(stored).toEqual(
      expect.objectContaining({
        blockedSessions: expect.arrayContaining([
          { sessionId: "00000000000000000000000000000010", expiresAt: expiry },
          { sessionId: "0000000000000000000000000000010f", expiresAt: expiry },
        ]),
      }),
    );
  });
  it("prunes blocked instances at their canonical expiry and fails closed if storage is unavailable", async () => {
    await recordCanonicalSession(A);
    await beginUserLogout({ ...A, expiresAt: "2000-01-01T00:00:00.000Z" });
    await recordCanonicalSession(B);
    expect(stored).toEqual(expect.objectContaining({ blockedSessions: [] }));
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("unavailable");
      },
    });
    expect(await scannerUploadSuspended(B.operatorUserId, B.sessionId)).toBe(true);
  });
});
