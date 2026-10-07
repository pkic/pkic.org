import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalSessionFixture } from "../helpers/portal-session";
import { eventAudienceDetailSchema, eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

const local = vi.hoisted(() => ({ active: vi.fn(), suspended: vi.fn() }));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  readActiveUserSession: local.active,
  scannerUploadSuspended: local.suspended,
}));
import { createScannerEventBootstrap } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-event-bootstrap";

const slug = "event-one";
const sponsorId = "10000000-0000-4000-8000-000000000003";
const canonical = eventDetailResponseSchema.parse({
  event: {
    id: "10000000-0000-4000-8000-000000000001",
    slug,
    name: "Prepared scanner event",
    timezone: "UTC",
    startsAt: null,
    endsAt: null,
    profileKey: null,
    registrationPolicy: "public",
    visibility: "invitation_only",
    accessLevel: "participant",
    location: "Organizer-only metadata must not be retained",
    links: [],
    basePath: null,
    viewer: null,
    sponsorLeadAccess: false,
    scannerAccess: { canScan: true, sponsors: [{ id: sponsorId, name: "Authorized sponsor" }] },
  },
});
let session: PortalSession | null;
let payload: unknown;
let status: number;
let offline: boolean;
const transport = vi.fn();
function freshSession(): PortalSession {
  const value = portalSessionFixture({ staff: true });
  return {
    ...value,
    staff: value.staff && {
      ...value.staff,
      expiresAt: value.expiresAt,
      idleExpiresAt: value.idleExpiresAt,
    },
  };
}
function json(value: unknown, responseStatus = 200) {
  return new Response(JSON.stringify(value), {
    status: responseStatus,
    headers: { "content-type": "application/json" },
  });
}
beforeEach(() => {
  session = freshSession();
  payload = canonical;
  status = 200;
  offline = false;
  local.active
    .mockReset()
    .mockImplementation(async () =>
      session ? { sessionId: session.sessionId, operatorUserId: session.identity.id } : null,
    );
  local.suspended.mockReset().mockResolvedValue(false);
  transport.mockReset().mockImplementation(async () => {
    if (offline) throw new TypeError("Network unavailable");
    return json(payload, status);
  });
  vi.stubGlobal("fetch", transport);
});
afterEach(() => vi.unstubAllGlobals());

describe("scanner-only in-memory event bootstrap", () => {
  it("reopens a prepared scanner on connectivity failure with only canonical minimal event metadata", async () => {
    const bootstrap = createScannerEventBootstrap(() => session);
    const online = await bootstrap.load(slug);
    expect(online).toEqual({
      event: {
        id: canonical.event.id,
        name: canonical.event.name,
        scannerAccess: eventAudienceDetailSchema.parse(canonical.event).scannerAccess,
      },
    });
    expect(online.event).not.toHaveProperty("location");
    expect(online.event).not.toHaveProperty("viewer");
    offline = true;
    expect(await bootstrap.load(slug)).toEqual(online);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(local.suspended).toHaveBeenLastCalledWith(session!.identity.id, session!.sessionId);
    offline = false;
    payload = { event: { ...canonical.event, name: "Current canonical name" } };
    expect((await bootstrap.load(slug)).event.name).toBe("Current canonical name");
  });

  it("never reuses another event, sponsor, person, or newer session's bootstrap", async () => {
    for (const change of ["event", "sponsor", "person", "session"] as const) {
      session = freshSession();
      offline = false;
      const bootstrap = createScannerEventBootstrap(() => session);
      await bootstrap.load(slug);
      offline = true;
      if (change === "person")
        session = { ...session, identity: { ...session.identity, id: "10000000-0000-4000-8000-000000000004" } };
      if (change === "session") session = { ...session, sessionId: "10000000-0000-4000-8000-000000000005" };
      await expect(
        bootstrap.load(change === "event" ? "another-event" : slug, change === "sponsor" ? sponsorId : undefined),
      ).rejects.toThrow("could not reach online services");
    }
  });

  it("clears the prepared context on authoritative refusals and malformed responses", async () => {
    for (const failure of [401, 403, 500, "schema"] as const) {
      offline = false;
      status = 200;
      payload = canonical;
      const bootstrap = createScannerEventBootstrap(() => session);
      await bootstrap.load(slug);
      status = failure === "schema" ? 200 : failure;
      payload = failure === "schema" ? { event: { id: "bad" } } : { error: { code: "REFUSED", message: "Refused" } };
      await expect(bootstrap.load(slug)).rejects.toThrow();
      offline = true;
      await expect(bootstrap.load(slug)).rejects.toThrow("could not reach online services");
    }
  });

  it("refuses expired or signed-out authority and clears its context instead of using saved metadata", async () => {
    for (const changed of ["session", "staff", "fence", "active"] as const) {
      session = freshSession();
      offline = false;
      local.suspended.mockResolvedValue(false);
      local.active.mockImplementation(async () => ({
        sessionId: session!.sessionId,
        operatorUserId: session!.identity.id,
      }));
      const bootstrap = createScannerEventBootstrap(() => session);
      await bootstrap.load(slug);
      const before = transport.mock.calls.length;
      offline = true;
      if (changed === "session") session = { ...session, idleExpiresAt: "2000-01-01T00:00:00.000Z" };
      if (changed === "staff")
        session = { ...session, staff: { ...session.staff!, expiresAt: "2000-01-01T00:00:00.000Z" } };
      if (changed === "fence") local.suspended.mockResolvedValue(true);
      if (changed === "active") local.active.mockResolvedValue(null);
      await expect(bootstrap.load(slug)).rejects.toThrow("Sign in again");
      expect(transport.mock.calls).toHaveLength(before);
      session = freshSession();
      local.suspended.mockResolvedValue(false);
      local.active.mockImplementation(async () => ({
        sessionId: session!.sessionId,
        operatorUserId: session!.identity.id,
      }));
      await expect(bootstrap.load(slug)).rejects.toThrow("could not reach online services");
    }
  });

  it("does not let an aborted route write a late successful response", async () => {
    let release!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const bootstrap = createScannerEventBootstrap(() => session);
    const abort = new AbortController();
    const loading = bootstrap.load(slug, undefined, abort.signal);
    const refusal = expect(loading).rejects.toThrow();
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    abort.abort();
    release(json(canonical));
    await refusal;
    offline = true;
    await expect(bootstrap.load(slug)).rejects.toThrow("could not reach online services");
  });

  it("rejects a late response after the canonical person or session changed", async () => {
    let release!: (response: Response) => void;
    transport.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const bootstrap = createScannerEventBootstrap(() => session);
    const loading = bootstrap.load(slug);
    const refusal = expect(loading).rejects.toThrow("Sign in again");
    await vi.waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    session = { ...session!, sessionId: "10000000-0000-4000-8000-000000000005" };
    bootstrap.sessionChanged();
    release(json(canonical));
    await refusal;
    offline = true;
    await expect(bootstrap.load(slug)).rejects.toThrow("could not reach online services");
  });
});
