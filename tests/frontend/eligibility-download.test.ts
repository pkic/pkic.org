import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEligibilitySnapshot } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-download";
import { cachedManifestSchema } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-snapshot";
import { enrolledOfflineEligibilityQuerySchema } from "../../assets/shared/schemas/event-offline-eligibility";
import { eligibilityPageDigest } from "../../assets/shared/event-eligibility-digest";

function fixture() {
  const now = Date.now();
  return cachedManifestSchema.parse({
    eventId: "00000000-0000-4000-8000-000000000001",
    operatorUserId: "00000000-0000-4000-8000-000000000002",
    epochId: "00000000-0000-4000-8000-000000000003",
    deviceId: "00000000-0000-4000-8000-000000000004",
    snapshotId: crypto.randomUUID(),
    occurrenceId: null,
    roomId: null,
    publishedRevision: 1,
    revision: 1,
    scopeDate: "2026-11-06",
    serverNow: new Date(now).toISOString(),
    expiresAt: new Date(now + 3600000).toISOString(),
    writtenAt: now,
    validUntil: now + 3600000,
    complete: true,
    session: null,
    entries: [
      {
        badgeId: "00000000-0000-4000-8000-000000000005",
        userId: "00000000-0000-4000-8000-000000000006",
        credentialHash: "a".repeat(64),
        revoked: false,
        eventRegistered: true,
        physicalDayEligible: true,
        sessionStatus: null,
        sessionEligible: true,
        privateAccess: true,
      },
    ],
  });
}
type Snapshot = ReturnType<typeof fixture>;
async function page(snapshot: Snapshot, overrides: Record<string, unknown> = {}, knownDigest?: string) {
  const { complete: _, writtenAt: __, validUntil: ___, snapshotId: ____, ...metadata } = snapshot;
  const data = { ...metadata, nextBadgeId: null, ...overrides };
  const pageDigest = await eligibilityPageDigest(data);
  const unchanged = knownDigest === pageDigest;
  return Response.json({ ...data, pageDigest, unchanged, ...(unchanged ? { entries: [] } : {}) });
}
function download(snapshot: Snapshot) {
  return downloadEligibilitySnapshot("synthetic", snapshot.operatorUserId, null, null, snapshot, undefined, snapshot);
}
function parseQuery(input: string) {
  return enrolledOfflineEligibilityQuerySchema.parse(
    Object.fromEntries(new URL(input, "https://test.invalid").searchParams),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Conditional eligibility page downloads", () => {
  it("renews an unchanged complete roster without transferring its entries", async () => {
    const snapshot = fixture();
    const fetcher = vi.fn(async (url: string) => {
      const query = parseQuery(url);
      expect(query.knownDigest).toMatch(/^[a-f0-9]{64}$/);
      const response = await page(snapshot, {}, query.knownDigest);
      expect((await response.clone().json()).entries).toEqual([]);
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await download(snapshot);
    expect(result.entries).toEqual(snapshot.entries);
    expect(result.complete).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("replaces rotated hashes and drops deleted badges without tombstones", async () => {
    const snapshot = fixture();
    const other = {
      ...snapshot.entries[0]!,
      badgeId: "00000000-0000-4000-8000-000000000007",
      credentialHash: "b".repeat(64),
    };
    snapshot.entries.push(other);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = parseQuery(url);
        return page(
          snapshot,
          { entries: [{ ...other, credentialHash: "c".repeat(64), revoked: true }] },
          query.knownDigest,
        );
      }),
    );
    const result = await download(snapshot);
    expect(result.entries).toEqual([{ ...other, credentialHash: "c".repeat(64), revoked: true }]);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[1]!.credentialHash).toBe("b".repeat(64));
  });

  it("does not renew or mutate saved evidence when a later page fails", async () => {
    const snapshot = fixture();
    snapshot.entries = Array.from({ length: 251 }, (_, i) => ({
      ...snapshot.entries[0]!,
      badgeId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const before = JSON.stringify(snapshot);
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (url: string) => {
        parseQuery(url);
        return page(snapshot, { entries: snapshot.entries.slice(0, 250), nextBadgeId: snapshot.entries[249]!.badgeId });
      })
      .mockImplementationOnce(async (url: string) => {
        expect(parseQuery(url).afterBadgeId).toBe(snapshot.entries[249]!.badgeId);
        throw new Error("Disconnected");
      });
    vi.stubGlobal("fetch", fetcher);
    await expect(download(snapshot)).rejects.toThrow("Disconnected");
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("restarts without the old fingerprint after a publication reset", async () => {
    const snapshot = fixture();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (url: string) => {
        expect(parseQuery(url).knownDigest).toBeDefined();
        return new Response(null, { status: 409 });
      })
      .mockImplementationOnce(async (url: string) => {
        expect(parseQuery(url).knownDigest).toBeUndefined();
        return page(snapshot, { publishedRevision: 2, entries: [{ ...snapshot.entries[0], revoked: true }] });
      });
    vi.stubGlobal("fetch", fetcher);
    const result = await download(snapshot);
    expect(result.entries[0]!.revoked).toBe(true);
    expect(result.publishedRevision).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("checks 1000 badges in bounded pages and transfers only a changed page on refresh", async () => {
    const snapshot = fixture();
    let inventory = Array.from({ length: 1000 }, (_, i) => ({
      ...snapshot.entries[0]!,
      badgeId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    let transferred = 0;
    const fetcher = vi.fn(async (url: string) => {
      const query = parseQuery(url);
      const start = query.afterBadgeId ? inventory.findIndex((entry) => entry.badgeId > query.afterBadgeId!) : 0;
      const entries = inventory.slice(start, start + 250);
      const response = await page(
        snapshot,
        { entries, nextBadgeId: inventory.length > start + 250 ? entries.at(-1)!.badgeId : null },
        query.knownDigest,
      );
      transferred += (await response.clone().json()).entries.length;
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    const initial = await downloadEligibilitySnapshot("synthetic", snapshot.operatorUserId, null, null, snapshot);
    expect(initial.entries).toHaveLength(1000);
    expect(transferred).toBe(1000);
    expect(fetcher).toHaveBeenCalledTimes(4);
    transferred = 0;
    expect((await download(initial)).entries).toHaveLength(1000);
    expect(transferred).toBe(0);
    inventory[700] = { ...inventory[700]!, revoked: true };
    const refreshed = await download(initial);
    expect(refreshed.entries[700]!.revoked).toBe(true);
    expect(transferred).toBe(250);
    // A deletion shifts page boundaries; rebuilding still removes it without a deletion log.
    inventory = inventory.slice(1);
    const smaller = await download(refreshed);
    expect(smaller.entries).toHaveLength(999);
    expect(smaller.entries[0]!.badgeId).toBe(inventory[0]!.badgeId);
    expect(smaller.entries.find((entry) => entry.badgeId === inventory[699]!.badgeId)?.revoked).toBe(true);
  });

  it.each([401, 403])("refuses permission denial %s without renewing the snapshot", async (status) => {
    const snapshot = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status })),
    );
    await expect(download(snapshot)).rejects.toThrow("SCANNER_PERMISSION_CHANGED");
  });

  it("refuses an unproven unchanged page", async () => {
    const snapshot = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ...JSON.parse(await (await page(snapshot)).text()),
          entries: [],
          unchanged: true,
          pageDigest: "0".repeat(64),
        }),
      ),
    );
    await expect(download(snapshot)).rejects.toThrow("not verified");
  });

  it("keeps the lease anchored to the first checked page", async () => {
    const snapshot = fixture();
    const entries = Array.from({ length: 251 }, (_, i) => ({
      ...snapshot.entries[0]!,
      badgeId: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(snapshot.writtenAt);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const query = parseQuery(url);
        if (!query.afterBadgeId)
          return page(snapshot, { entries: entries.slice(0, 250), nextBadgeId: entries[249]!.badgeId });
        clock.mockReturnValue(snapshot.writtenAt + 60_000);
        return page(snapshot, {
          entries: entries.slice(250),
          serverNow: new Date(snapshot.writtenAt + 60_000).toISOString(),
          expiresAt: new Date(snapshot.validUntil + 60_000).toISOString(),
        });
      }),
    );
    expect((await download(snapshot)).validUntil).toBe(snapshot.validUntil);
  });
});
