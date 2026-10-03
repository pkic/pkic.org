import { webcrypto } from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildEligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";

const badge = "00000000-0000-4000-8000-000000000004";
async function fixture() {
  vi.stubGlobal("crypto", webcrypto);
  const hash = Array.from(
    new Uint8Array(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(badge))),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const now = Date.now();
  return {
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
        badgeId: badge,
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
describe("local scoped eligibility manifest", () => {
  it("rechecks expiry after a delayed badge digest before displaying eligibility", async () => {
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
    expect(await result).toMatchObject({ outcome: "unverified", reason: "verification_required" });
  });
  it("validates 2000 badges without network or database access and distinguishes unknown badges", async () => {
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
    expect((await manifest.lookup("00000000-0000-4000-8000-000000000099")).outcome).toBe("unknown");
  });
  it("reports a known attendee without event/session entitlement and revoked badges separately", async () => {
    const snapshot = await fixture();
    snapshot.entries[0].eventRegistered = false;
    expect(await buildEligibilityManifest(snapshot).lookup(badge)).toMatchObject({
      outcome: "warning",
      reason: "missing_registration",
    });
    snapshot.entries[0].revoked = true;
    expect(await buildEligibilityManifest(snapshot).lookup(badge)).toMatchObject({
      outcome: "denied",
      reason: "revoked_badge",
    });
  });
  it("never verifies expired snapshots, capacity without a reservation or missing private access", async () => {
    const snapshot = await fixture();
    const expired = { ...snapshot, writtenAt: snapshot.writtenAt - 900001, validUntil: snapshot.writtenAt - 1 };
    expect((await buildEligibilityManifest(expired).lookup(badge)).outcome).toBe("unverified");
    const limited = {
      ...snapshot,
      session: { admissionPolicy: "reservation", visibility: "public" },
      entries: [{ ...snapshot.entries[0], sessionEligible: false }],
    };
    expect(await buildEligibilityManifest(limited).lookup(badge)).toMatchObject({
      outcome: "warning",
      reason: "capacity",
    });
    limited.session.visibility = "private";
    limited.entries[0].privateAccess = false;
    expect((await buildEligibilityManifest(limited).lookup(badge)).outcome).toBe("denied");
  });
  it("rejects profile fields and lifetimes over fifteen minutes before indexing/persistence", async () => {
    const snapshot = await fixture();
    expect(() => buildEligibilityManifest({ ...snapshot, email: "synthetic@example.test" })).toThrow();
    expect(() =>
      buildEligibilityManifest({ ...snapshot, entries: [{ ...snapshot.entries[0], name: "Synthetic attendee" }] }),
    ).toThrow();
    expect(() => buildEligibilityManifest({ ...snapshot, validUntil: snapshot.writtenAt + 900001 })).toThrow();
  });
});
