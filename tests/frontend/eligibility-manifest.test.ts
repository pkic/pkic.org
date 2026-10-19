vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  scannerUploadSuspended: vi.fn(async () => false),
  readActiveUserSession: vi.fn(async () => ({
    sessionId: "00000000-0000-4000-8000-000000000010",
    operatorUserId: "00000000-0000-4000-8000-000000000002",
  })),
}));
import { offlineEligibilityExpiresAt } from "../../assets/shared/event-offline-expiry";
import { webcrypto } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { enrolledOfflineEligibilityQuerySchema } from "../../assets/shared/schemas/event-offline-eligibility";
import {
  prepareEligibilityManifest,
  buildEligibilityManifest,
  pruneExpiredEligibilityManifests,
  clearOperatorEligibilityManifests,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";

const badge = "ABCDEFGHJKLMNPQR";
async function fixture() {
  vi.stubGlobal("crypto", webcrypto);
  const hash = Array.from(
    new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(badge))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const now = Date.now();
  return {
    epochId: "77777777-7777-4777-8777-777777777777",
    deviceId: "22222222-2222-4222-8222-222222222222",
    eventId: "00000000-0000-4000-8000-000000000001",
    operatorUserId: "00000000-0000-4000-8000-000000000002",
    occurrenceId: null,
    publishedRevision: 1,
    revision: 1,
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(now + 900000).toISOString(),
    writtenAt: now,
    validUntil: now + 900000,
    session: null,
    entries: [
      {
        badgeId: "00000000-0000-4000-8000-000000000004",
        userId: "00000000-0000-4000-8000-000000000003",
        credentialHash: hash,
        revoked: false,
        eventRegistered: true,
        physicalDayEligible: true,
        sessionStatus: null,
        sessionEligible: true,
        privateAccess: true,
      },
    ],
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function stubManifestStorage(saved: Map<string, unknown>) {
  const open = vi.fn((name: string) => {
    expect(name).toBe("pkic-scanner-eligibility");
    const opening = {
      result: {
        close: () => {},
        transaction: (store: string) => {
          expect(store).toBe("manifests");
          const transaction = {
            oncomplete: null as (() => void) | null,
            objectStore: () => ({
              put: (value: unknown, key: string) => {
                saved.set(key, value);
                return request(value);
              },
              get: (key: string) => request(saved.get(key)),
              openCursor: () => {
                const keys = [...saved.keys()];
                let index = 0;
                const cursorRequest = {
                  result: null as null | { value: unknown; delete(): void; continue(): void },
                  onsuccess: null as (() => void) | null,
                };
                const advance = () =>
                  queueMicrotask(() => {
                    const key = keys[index++];
                    cursorRequest.result =
                      key === undefined
                        ? null
                        : {
                            value: saved.get(key),
                            delete: () => {
                              saved.delete(key);
                            },
                            continue: advance,
                          };
                    cursorRequest.onsuccess?.();
                    if (key === undefined) transaction.oncomplete?.();
                  });
                advance();
                return cursorRequest;
              },
            }),
          };
          const request = (result: unknown) => {
            const value = { result, onsuccess: null as (() => void) | null };
            queueMicrotask(() => {
              value.onsuccess?.();
              transaction.oncomplete?.();
            });
            return value;
          };
          return transaction;
        },
      },
      onsuccess: null as (() => void) | null,
    };
    queueMicrotask(() => opening.onsuccess?.());
    return opening;
  });
  vi.stubGlobal("indexedDB", { open });
  return open;
}
describe("local scoped eligibility manifest", () => {
  it("clears only the signed-out owner's cached eligibility without touching other storage", async () => {
    const snapshot = await fixture();
    const other = { ...snapshot, operatorUserId: "00000000-0000-4000-8000-000000000009" };
    const saved = new Map<string, unknown>([
      ["owner-A", snapshot],
      ["owner-B", other],
    ]);
    const open = stubManifestStorage(saved);
    await clearOperatorEligibilityManifests(snapshot.operatorUserId);
    expect([...saved.entries()]).toEqual([["owner-B", other]]);
    expect(open).toHaveBeenCalledExactlyOnceWith("pkic-scanner-eligibility", 1);
  });
  it("retains an explicit native event profile and zone without inventing publication authority", async () => {
    const snapshot = {
      ...(await fixture()),
      publishedRevision: null,
      nativeEventContext: { profileKey: "meeting", timeZone: "Asia/Kuala_Lumpur" },
    };
    const manifest = buildEligibilityManifest(snapshot);
    expect(manifest.nativeEventContext).toEqual(snapshot.nativeEventContext);
    expect(manifest.publishedRevision).toBeNull();
  });
  it("verifies checkout credentials independently of entry entitlement while retaining credential expiry checks", async () => {
    const snapshot = await fixture();
    const departed = {
      ...snapshot,
      session: { admissionPolicy: "reservation", visibility: "private" },
      entries: [
        {
          ...snapshot.entries[0],
          eventRegistered: false,
          physicalDayEligible: false,
          allocationCompatible: false,
          privateAccess: false,
          sessionEligible: false,
        },
      ],
    };
    expect(await buildEligibilityManifest(departed).lookup(badge, "checkout")).toMatchObject({
      outcome: "eligible",
      userId: departed.entries[0].userId,
      message: "Checkout saved on this device. Upload pending.",
    });
    expect((await buildEligibilityManifest(departed).lookup(badge, "attendance")).outcome).toBe("warning");
    departed.entries[0].revoked = true;
    expect((await buildEligibilityManifest(departed).lookup(badge, "checkout")).reason).toBe("revoked_badge");
    const expiredBadge = {
      ...departed,
      entries: [{ ...departed.entries[0], revoked: false, expiresAt: new Date(snapshot.writtenAt - 1).toISOString() }],
    };
    expect((await buildEligibilityManifest(expiredBadge).lookup(badge, "checkout")).reason).toBe("expired_badge");
    const expiredSnapshot = { ...snapshot, writtenAt: snapshot.writtenAt - 900001, validUntil: snapshot.writtenAt - 1 };
    expect(await buildEligibilityManifest(expiredSnapshot).lookup(badge, "checkout")).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
    });
    expect(
      await buildEligibilityManifest({
        ...expiredSnapshot,
        entries: [{ ...snapshot.entries[0], revoked: true }],
      }).lookup(badge),
    ).toMatchObject({
      outcome: "denied",
      reason: "revoked_badge",
      message: expect.stringContaining("saved snapshot"),
    });
    expect(
      await buildEligibilityManifest({
        ...expiredSnapshot,
        entries: [{ ...snapshot.entries[0], expiresAt: new Date(snapshot.writtenAt - 1).toISOString() }],
      }).lookup(badge),
    ).toMatchObject({
      outcome: "denied",
      reason: "expired_badge",
    });
  });
  it("clamps longer event rights to the actual timezone day boundary", () => {
    expect(offlineEligibilityExpiresAt("2026-10-03T21:55:00.000Z", "Europe/Amsterdam", 4 * 60 * 60_000)).toBe(
      "2026-10-03T22:00:00.000Z",
    );
    expect(offlineEligibilityExpiresAt("2026-10-25T21:55:00.000Z", "Europe/Amsterdam", 4 * 60 * 60_000)).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });
  it("qualifies a recognized badge when the snapshot expires during hashing", async () => {
    const snapshot = await fixture();
    let release: (value: ArrayBuffer) => void = () => {};
    vi.stubGlobal("crypto", {
      subtle: {
        digest: () =>
          new Promise<ArrayBuffer>((resolve) => {
            release = resolve;
          }),
      },
    });
    const result = buildEligibilityManifest(snapshot).lookup(badge);
    vi.spyOn(Date, "now").mockReturnValue(snapshot.validUntil + 1);
    release(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(badge)));
    expect(await result).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
    });
  });
  it("identifies unknown IDs only after the full scoped inventory was downloaded", async () => {
    const snapshot = await fixture();
    const unknown = "23456789ABCDEFGH";
    expect(await buildEligibilityManifest({ ...snapshot, complete: true }).lookup(unknown)).toMatchObject({
      outcome: "unknown",
      reason: "unknown_credential",
    });
    expect(await buildEligibilityManifest({ ...snapshot, complete: false }).lookup(unknown)).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
    });
  });
  it("validates 2000 badges without network or database access and keeps a cached-roster miss distinct from an online unknown badge", async () => {
    const snapshot = await fixture();
    const network = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("No scan may query storage");
      },
    });
    const manifest = buildEligibilityManifest(snapshot);
    for (let index = 0; index < 2000; index++) expect((await manifest.lookup(badge)).outcome).toBe("eligible");
    expect(network).not.toHaveBeenCalled();
    expect(await manifest.lookup("23456789ABCDEFGH")).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
    });
  });
  it("reports a known attendee without event/session entitlement and revoked badges separately", async () => {
    const snapshot = await fixture();
    snapshot.entries[0].eventRegistered = false;
    expect(await buildEligibilityManifest(snapshot).lookup(badge)).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      userId: snapshot.entries[0].userId,
    });
    snapshot.entries[0].revoked = true;
    expect(await buildEligibilityManifest(snapshot).lookup(badge)).toMatchObject({
      outcome: "denied",
      reason: "revoked_badge",
    });
  });
  it("keeps recognized IDs while qualifying expired feedback and reporting fresh registration warnings", async () => {
    const snapshot = await fixture();
    const expired = { ...snapshot, writtenAt: snapshot.writtenAt - 900001, validUntil: snapshot.writtenAt - 1 };
    expect(await buildEligibilityManifest(expired).lookup(badge)).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
      message: expect.stringContaining("expired snapshot"),
    });
    expect(await buildEligibilityManifest({ ...expired, complete: true }).lookup("23456789ABCDEFGH")).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
    });
    const limited = {
      ...snapshot,
      session: { admissionPolicy: "reservation", visibility: "public" },
      entries: [{ ...snapshot.entries[0], sessionEligible: false }],
    };
    expect(await buildEligibilityManifest(limited).lookup(badge)).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
    });
    limited.session.visibility = "private";
    limited.entries[0].privateAccess = false;
    expect(await buildEligibilityManifest(limited).lookup(badge, "attendance")).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
      userId: limited.entries[0].userId,
    });
  });
  it("warns on a known location mismatch without treating scanning as entry control", async () => {
    const snapshot = await fixture();
    const scoped = { ...snapshot, entries: [{ ...snapshot.entries[0], allocationCompatible: false }] };
    const observed = await buildEligibilityManifest(scoped).lookup(badge, "attendance");
    expect(observed).toMatchObject({ outcome: "warning", reason: "wrong_location", userId: scoped.entries[0].userId });
    expect(observed.message).toContain("can still be recorded");
    expect(observed.message).not.toMatch(/Do not admit|capacity confirmation/);
  });
  it("reports registration separately from durable attendance upload without admission claims", async () => {
    const snapshot = await fixture();
    expect(await buildEligibilityManifest(snapshot).lookup(badge, "check")).toMatchObject({
      outcome: "eligible",
      message: "Registered.",
    });
    expect(await buildEligibilityManifest(snapshot).lookup(badge, "attendance")).toMatchObject({
      outcome: "eligible",
      message: "Registered. Attendance saved on this device; upload pending.",
    });
    const session = { ...snapshot, session: { admissionPolicy: "reservation", visibility: "public" } };
    expect((await buildEligibilityManifest(session).lookup(badge, "attendance")).message).not.toMatch(
      /admission|capacity/i,
    );
  });
  it("rejects profile fields and lifetimes over fifteen minutes before indexing/persistence", async () => {
    const snapshot = await fixture();
    expect(() => buildEligibilityManifest({ ...snapshot, email: "synthetic@example.test" })).toThrow();
    expect(() =>
      buildEligibilityManifest({ ...snapshot, entries: [{ ...snapshot.entries[0], name: "Synthetic attendee" }] }),
    ).toThrow();
    expect(() => buildEligibilityManifest({ ...snapshot, validUntil: snapshot.writtenAt + 900001 })).toThrow();
  });
  it("binds downloaded and cached manifests to the enrolled epoch and device", async () => {
    const snapshot = await fixture();
    const saved = new Map<string, unknown>();
    stubManifestStorage(saved);
    const { writtenAt: _written, validUntil: _valid, ...page } = snapshot;
    const fetcher = vi.fn(async (input: string) => {
      const query = enrolledOfflineEligibilityQuerySchema.parse(
        Object.fromEntries(new URL(input, "https://pkic.example").searchParams),
      );
      expect(query.epochId).toBe(snapshot.epochId);
      expect(query.deviceId).toBe(snapshot.deviceId);
      return Response.json({ ...page, nextBadgeId: null });
    });
    vi.stubGlobal("fetch", fetcher);
    const enrolled = { epochId: snapshot.epochId, deviceId: snapshot.deviceId };
    await expect(
      prepareEligibilityManifest("synthetic-event", snapshot.operatorUserId, null, enrolled),
    ).resolves.toBeTruthy();
    fetcher.mockRejectedValueOnce(new Error("Offline"));
    await expect(
      prepareEligibilityManifest("synthetic-event", snapshot.operatorUserId, null, enrolled),
    ).resolves.toBeTruthy();
    fetcher.mockRejectedValueOnce(new Error("Offline"));
    await expect(
      prepareEligibilityManifest("synthetic-event", snapshot.operatorUserId, null, {
        ...enrolled,
        epochId: "88888888-8888-4888-8888-888888888888",
      }),
    ).rejects.toThrow("Offline");
  });
  it("honors the server expiry boundary even before the local freshness window ends", async () => {
    const snapshot = await fixture();
    const expired = { ...snapshot, expiresAt: new Date(snapshot.writtenAt - 1).toISOString() };
    expect(await buildEligibilityManifest(expired).lookup(badge)).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
    });
  });
  it("does not claim eligibility or an unknown badge after the device clock rolls back", async () => {
    const snapshot = await fixture();
    vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt - 1);
    const manifest = buildEligibilityManifest({ ...snapshot, complete: true });
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified", userId: snapshot.entries[0].userId });
    expect(await manifest.lookup("23456789ABCDEFGH")).toMatchObject({ outcome: "unverified" });
  });
  it("prunes expired manifests without opening the independent attempt or recovery database", async () => {
    const snapshot = await fixture();
    const expired = { ...snapshot, writtenAt: snapshot.writtenAt - 900001, validUntil: snapshot.writtenAt - 1 };
    const saved = new Map<string, unknown>([
      ["fresh", snapshot],
      ["expired", expired],
      ["invalid", { profile: "must not remain" }],
    ]);
    const open = stubManifestStorage(saved);
    await pruneExpiredEligibilityManifests();
    expect([...saved.keys()]).toEqual(["fresh"]);
    expect(open).toHaveBeenCalledExactlyOnceWith("pkic-scanner-eligibility", 1);
  });
  it("removes an expired persisted fallback but retains qualified recognized feedback for this foreground session", async () => {
    const snapshot = await fixture();
    const enrollment = { epochId: snapshot.epochId, deviceId: snapshot.deviceId };
    const key = JSON.stringify([
      snapshot.operatorUserId,
      "synthetic-event",
      null,
      null,
      enrollment.epochId,
      enrollment.deviceId,
    ]);
    const saved = new Map<string, unknown>([
      [key, { ...snapshot, writtenAt: snapshot.writtenAt - 900001, validUntil: snapshot.writtenAt - 1 }],
    ]);
    stubManifestStorage(saved);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const manifest = await prepareEligibilityManifest("synthetic-event", snapshot.operatorUserId, null, enrollment);
    expect(saved.size).toBe(0);
    expect(manifest.serverNow).toBe(snapshot.serverNow);
    expect(manifest.expiresAt).toBe(snapshot.expiresAt);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified", userId: snapshot.entries[0].userId });
  });
  it("projects the original server snapshot timestamps without substituting device time", async () => {
    const snapshot = await fixture();
    const manifest = buildEligibilityManifest(snapshot);
    expect(manifest.serverNow).toBe(snapshot.serverNow);
    expect(manifest.expiresAt).toBe(snapshot.expiresAt);
  });
  it.each([-60 * 60_000, 60 * 60_000])(
    "keeps server-relative freshness and badge expiry correct with a device offset of %ims",
    async (offset) => {
      const snapshot = await fixture();
      const serverTime = snapshot.writtenAt - offset;
      const shifted = {
        ...snapshot,
        serverNow: new Date(serverTime).toISOString(),
        expiresAt: new Date(serverTime + 900000).toISOString(),
        entries: [{ ...snapshot.entries[0], expiresAt: new Date(serverTime + 600000).toISOString() }],
      };
      expect(await buildEligibilityManifest(shifted).lookup(badge)).toMatchObject({
        outcome: "eligible",
        userId: snapshot.entries[0].userId,
      });
      vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 600001);
      expect(await buildEligibilityManifest(shifted).lookup(badge)).toMatchObject({
        outcome: "unverified",
        reason: "verification_required",
        userId: snapshot.entries[0].userId,
      });
    },
  );
  it("treats a forward device-clock jump as unverified instead of a badge-expiry denial", async () => {
    const snapshot = await fixture();
    const manifest = buildEligibilityManifest({
      ...snapshot,
      entries: [{ ...snapshot.entries[0], expiresAt: new Date(snapshot.writtenAt + 600000).toISOString() }],
    });
    vi.spyOn(Date, "now").mockReturnValue(snapshot.validUntil + 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
    });
  });
  it.each(["forward", "rollback"] as const)(
    "does not misclassify a badge as expired when the clock changes %s during hashing",
    async (direction) => {
      const snapshot = await fixture();
      let release: (value: ArrayBuffer) => void = () => {};
      vi.stubGlobal("crypto", {
        subtle: {
          digest: () =>
            new Promise<ArrayBuffer>((resolve) => {
              release = resolve;
            }),
        },
      });
      const manifest = buildEligibilityManifest({
        ...snapshot,
        entries: [{ ...snapshot.entries[0], expiresAt: new Date(snapshot.writtenAt + 600000).toISOString() }],
      });
      const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 120_000);
      const pending = manifest.lookup(badge);
      clock.mockReturnValue(direction === "forward" ? snapshot.validUntil + 60_000 : snapshot.writtenAt + 60_000);
      release(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(badge)));
      expect(await pending).toMatchObject({
        outcome: "unverified",
        reason: "verification_required",
        userId: snapshot.entries[0].userId,
      });
    },
  );
  it("never revives the same retained snapshot after observed expiry and a device-clock rewind", async () => {
    const snapshot = await fixture();
    const manifest = buildEligibilityManifest(snapshot);
    const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 16 * 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified", userId: snapshot.entries[0].userId });
    clock.mockReturnValue(snapshot.writtenAt + 5 * 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      userId: snapshot.entries[0].userId,
    });
    // A newly verified snapshot can establish a new freshness window.
    const refreshed = {
      ...snapshot,
      writtenAt: Date.now(),
      validUntil: Date.now() + 900000,
      serverNow: new Date(Date.now()).toISOString(),
      expiresAt: new Date(Date.now() + 900000).toISOString(),
    };
    expect(await buildEligibilityManifest(refreshed).lookup(badge)).toMatchObject({ outcome: "eligible" });
  });
  it("keeps a cross-lookup clock rollback unverified after an earlier valid scan", async () => {
    const snapshot = await fixture();
    const manifest = buildEligibilityManifest(snapshot);
    const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 5 * 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "eligible" });
    clock.mockReturnValue(snapshot.writtenAt + 4 * 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified" });
    clock.mockReturnValue(snapshot.writtenAt + 6 * 60_000);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified" });
  });
  it("does not restore eligibility after future badge-expiry uncertainty and a rewind", async () => {
    const snapshot = await fixture();
    const manifest = buildEligibilityManifest({
      ...snapshot,
      entries: [{ ...snapshot.entries[0], expiresAt: new Date(snapshot.writtenAt + 600000).toISOString() }],
    });
    const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 600001);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified", reason: "verification_required" });
    clock.mockReturnValue(snapshot.writtenAt + 300000);
    expect(await manifest.lookup(badge)).toMatchObject({ outcome: "unverified", reason: "verification_required" });
  });
  it.each(["revoked", "expired"] as const)(
    "preserves the server-observed %s denial after snapshot invalidation and rewind",
    async (fact) => {
      const snapshot = await fixture();
      const manifest = buildEligibilityManifest({
        ...snapshot,
        entries: [
          {
            ...snapshot.entries[0],
            revoked: fact === "revoked",
            expiresAt: fact === "expired" ? new Date(Date.parse(snapshot.serverNow) - 1).toISOString() : null,
          },
        ],
      });
      const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt + 16 * 60_000);
      expect((await manifest.lookup(badge)).reason).toBe(fact === "revoked" ? "revoked_badge" : "expired_badge");
      clock.mockReturnValue(snapshot.writtenAt + 5 * 60_000);
      expect(await manifest.lookup(badge)).toMatchObject({
        outcome: "denied",
        reason: fact === "revoked" ? "revoked_badge" : "expired_badge",
      });
    },
  );
});
