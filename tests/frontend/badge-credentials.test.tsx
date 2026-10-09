// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  badgeCredentialMetadataSchema,
  badgeAttendeesResponseSchema,
  badgeCredentialsQuerySchema,
  badgeCredentialsResponseSchema,
  badgeIssueRequestSchema,
  badgePrintingResponseSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { BadgeCredentials } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeCredentials";
import { BadgeIssuance } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/BadgeIssuance";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";

import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

const navigate = vi.fn();
const qr = vi.fn(
  async (..._args: unknown[]) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 37 37"><path d="M4 4h1v1H4z"/></svg>',
);
const viewer = vi.hoisted(() => ({ timeZone: "UTC" }));
vi.mock("../../assets/ts/member-flows/portal/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/member-flows/portal/ui")>()),
  browserTimeZone: () => viewer.timeZone,
}));
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
vi.mock("qrcode", () => ({ default: { toString: (...args: unknown[]) => qr(...args) } }));
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));

const BASE = "/groups/example/events/workshop/registrations/badges";
const ID = "10000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000002";
const NEXT = "10000000-0000-4000-8000-000000000003";
const BEARER = "ABCDEFGHJKLMNPQR";
const metadata = badgeCredentialMetadataSchema.parse({
  id: ID,
  eventId: "10000000-0000-4000-8000-000000000005",
  userId: USER,
  displayName: "Sam Speaker",
  createdAt: "2026-10-05T10:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  status: "active",
});
const mounted: HTMLElement[] = [];
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function mount(node: ComponentChildren): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  void act(() => render(node, host));
  return host;
}
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function click(host: HTMLElement, label: string): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeDefined();
  await act(async () => {
    button!.click();
  });
  await settle();
}
async function submit(host: HTMLElement): Promise<void> {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}
function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

beforeEach(() => {
  clearAuth();
  savePortalSession(portalSessionFixture({ member: true }));
  viewer.timeZone = "UTC";
  navigate.mockReset();
  qr.mockClear();
  vi.mocked(confirmAction).mockClear();
});
afterEach(() => {
  for (const host of mounted.splice(0)) {
    void act(() => render(null, host));
    host.remove();
  }
  clearAuth();
  vi.unstubAllGlobals();
});

describe("badge credentials", () => {
  it("creates an additional credential through the registered-attendee picker without replacing any existing badge", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (requestUrl(input).pathname.endsWith("/attendees")) {
          return json(
            badgeAttendeesResponseSchema.parse({
              users: [{ id: USER, email: "sam@example.test", first_name: "Sam", last_name: "Speaker" }],
              page: { limit: 50, offset: 0, total: 1, hasMore: false },
            }),
          );
        }
        bodies.push(JSON.parse(String(init?.body)));
        return json({
          result: "issued",
          id: NEXT,
          credential: BEARER,
          expiresAt: metadata.expiresAt,
          replacedBadgeId: null,
        });
      }),
    );
    const host = mount(<BadgeCredentials slug="workshop" basePath={BASE} credentialId="new" />);
    const input = host.querySelector<HTMLInputElement>('input[name="userId"]')!;
    await act(() => {
      input.value = "sam";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    const match = host.querySelector<HTMLButtonElement>('[aria-label="Matching users"] button');
    expect(match).not.toBeNull();
    await act(() => {
      match!.click();
    });
    await submit(host);
    const request = badgeIssueRequestSchema.parse(bodies[0]);
    expect(request.userId).toBe(USER);
    expect(request.replaceBadgeId).toBeUndefined();
    expect(host.textContent).toContain("Badge created");
  });

  it("loads bounded metadata with canonical user filtering and opens a dedicated create route", async () => {
    const urls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(requestUrl(input));
        return json(
          badgeCredentialsResponseSchema.parse({
            badges: [{ ...metadata, displayName: null }],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        );
      }),
    );
    const host = mount(<BadgeCredentials slug="workshop" basePath={BASE} userId={USER} />);
    await settle();
    const query = badgeCredentialsQuerySchema.parse(Object.fromEntries(urls[0].searchParams));
    expect(query.userId).toBe(USER);
    expect(query.sort).toBe("-createdAt");
    expect(host.textContent).toContain("Attendee name unavailable");
    expect(host.querySelector('a[href*="' + ID + '"]')).not.toBeNull();
    expect(host.querySelector("table form")).toBeNull();
    expect(host.querySelector('input[name="userId"]')).toBeNull();
    expect(host.querySelector("img")).toBeNull();
    await click(host, "Create badge");
    expect(navigate).toHaveBeenCalledWith(`${BASE}/new?userId=${USER}`);
  });

  it("reloads a selected metadata record without exposing a printable credential", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => json(metadata));
    vi.stubGlobal("fetch", fetch);
    const host = mount(<BadgeCredentials slug="workshop" basePath={BASE} credentialId={ID} />);
    await settle();
    expect(host.textContent).toContain(ID);
    expect(host.textContent).toContain("Sam Speaker");
    expect(host.textContent).not.toContain(BEARER);
    expect(host.querySelector("img, form")).toBeNull();
    expect(requestUrl(fetch.mock.calls[0][0] as RequestInfo).pathname).toBe(`/api/v1/events/workshop/badges/${ID}`);
    await click(host, "Record actions");
    await click(host, "Replace credential");
    expect(navigate).toHaveBeenCalledWith(`${BASE}/${ID}/replace`);
  });

  it("refuses a metadata response that incorrectly contains a bearer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ ...metadata, credential: BEARER })),
    );
    const host = mount(<BadgeCredentials slug="workshop" basePath={BASE} credentialId={ID} />);
    await settle();
    expect(host.textContent).not.toContain(BEARER);
    expect(host.querySelector("img, form")).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("replaces only the selected record and shows a fresh printable bearer only in the issuance result", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestUrl(input).pathname;
        if (path.endsWith("/printing"))
          return json(badgePrintingResponseSchema.parse({ revision: "1".repeat(64), template: null, branding: [] }));
        if (path.endsWith("/print")) {
          expect(badgePrintRequestSchema.parse(JSON.parse(String(init?.body))).printingRevision).toBe("1".repeat(64));
          return json(
            badgePrintResponseSchema.parse({
              id: NEXT,
              displayName: metadata.displayName,
              firstName: "Sam",
              lastName: "Speaker",
              organization: null,
              badgeRole: "speaker",
              printingRevision: "1".repeat(64),
              expiresAt: metadata.expiresAt,
              svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Badge code</text><text>ABCD-EFGH-JKLM-NPQR</text></svg>',
            }),
          );
        }
        if (!init?.body) return json({ ...metadata, id: NEXT });
        bodies.push(JSON.parse(String(init.body)));
        return json({
          result: "issued",
          id: NEXT,
          credential: BEARER,
          expiresAt: metadata.expiresAt,
          replacedBadgeId: ID,
        });
      }),
    );
    const host = mount(<BadgeIssuance slug="workshop" replacement={metadata} onBack={vi.fn()} onRecord={navigate} />);
    expect(host.querySelector('input[name="userId"]')).toBeNull();
    expect(host.textContent).toContain("Replacing badge");
    await submit(host);
    const request = badgeIssueRequestSchema.parse(bodies[0]);
    expect(request.userId).toBe(USER);
    expect(request.replaceBadgeId).toBe(ID);
    expect(host.textContent).not.toContain(BEARER);
    expect(host.textContent).toContain(NEXT);
    expect(host.querySelector('img[alt="Attendee badge QR code"]')).not.toBeNull();
    const printable = decodeURIComponent(
      host.querySelector<HTMLImageElement>('img[alt="Attendee badge QR code"]')!.src.split(",")[1]!,
    );
    expect(printable).toContain(">Badge code</text>");
    expect(printable).toContain(">ABCD-EFGH-JKLM-NPQR</text>");
    expect(qr).not.toHaveBeenCalled();
    await click(host, "Badge actions");
    await click(host, "View badge");
    expect(navigate).toHaveBeenCalledWith(NEXT);
  });

  it("retains the operation ID after a failed unchanged request and renders a metadata-only completed retry", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) throw new Error("Connection lost");
        return json({
          result: "replayed",
          id: NEXT,
          credential: null,
          expiresAt: metadata.expiresAt,
          replacedBadgeId: ID,
        });
      }),
    );
    const host = mount(<BadgeIssuance slug="workshop" replacement={metadata} onBack={vi.fn()} onRecord={navigate} />);
    await submit(host);
    expect(host.querySelector("form")).not.toBeNull();
    await submit(host);
    const first = badgeIssueRequestSchema.parse(bodies[0]);
    const retry = badgeIssueRequestSchema.parse(bodies[1]);
    expect(retry).toEqual(first);
    expect(host.textContent).toContain("This request was already completed");
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).not.toContain(BEARER);
    expect(qr).not.toHaveBeenCalled();
    await click(host, "Badge actions");
    expect(host.textContent).not.toContain("Print QR");
  });

  it("allocates a new operation for changed expiry after a failed request", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        throw new Error("Connection lost");
      }),
    );
    const host = mount(<BadgeIssuance slug="workshop" replacement={metadata} onBack={vi.fn()} onRecord={navigate} />);
    await submit(host);
    const expiry = host.querySelector<HTMLInputElement>('input[name="expiresAt"]')!;
    await act(() => {
      expiry.value = "2026-10-07T12:00";
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(host);
    const first = badgeIssueRequestSchema.parse(bodies[0]);
    const changed = badgeIssueRequestSchema.parse(bodies[1]);
    expect(changed.operationId).not.toBe(first.operationId);
    expect(changed.expiresAt).toBe("2026-10-07T12:00:00.000Z");
    expect(changed.replaceBadgeId).toBe(ID);
  });

  it("sends a viewer-local expiry as the correct UTC instant in the canonical request", async () => {
    viewer.timeZone = "Europe/Amsterdam";
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({
          result: "replayed",
          id: NEXT,
          credential: null,
          expiresAt: "2027-01-15T11:00:00.000Z",
          replacedBadgeId: ID,
        });
      }),
    );
    const host = mount(<BadgeIssuance slug="workshop" replacement={metadata} onBack={vi.fn()} onRecord={navigate} />);
    expect(host.textContent).toContain("Your time (Europe/Amsterdam)");
    const expiry = host.querySelector<HTMLInputElement>('input[name="expiresAt"]')!;
    await act(() => {
      expiry.value = "2027-01-15T12:00";
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(host);
    expect(badgeIssueRequestSchema.parse(bodies[0]).expiresAt).toBe("2027-01-15T11:00:00.000Z");
  });

  it("refuses a nonexistent daylight-saving wall clock without rendering failure or an API write", async () => {
    viewer.timeZone = "Europe/Amsterdam";
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const host = mount(<BadgeIssuance slug="workshop" replacement={metadata} onBack={vi.fn()} onRecord={navigate} />);
    const expiry = host.querySelector<HTMLInputElement>('input[name="expiresAt"]')!;
    await act(() => {
      expiry.value = "2027-03-28T02:30";
      expiry.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(host);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.querySelector("form")).not.toBeNull();
    expect(expiry.getAttribute("aria-invalid")).toBe("true");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("revokes exactly the selected credential and reloads persisted status", async () => {
    const requests: { url: URL; method: string }[] = [];
    let revoked = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({ url: requestUrl(input), method: init?.method ?? "GET" });
        if (init?.method === "DELETE") {
          revoked = true;
          return json({ success: true });
        }
        return json(revoked ? { ...metadata, status: "revoked", revokedAt: "2026-10-05T11:00:00.000Z" } : metadata);
      }),
    );
    const host = mount(<BadgeCredentials slug="workshop" basePath={BASE} credentialId={ID} />);
    await settle();
    await click(host, "Record actions");
    await click(host, "Revoke credential");
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Only this credential will stop working. Other credentials for this attendee remain valid.",
      }),
    );
    expect(requests.filter((item) => item.method === "DELETE").map((item) => item.url.pathname)).toEqual([
      `/api/v1/events/workshop/badges/${ID}`,
    ]);
    expect(requests.filter((item) => item.method === "GET")).toHaveLength(2);
    expect(host.textContent).toContain("Revoked");
    expect(host.querySelector("img")).toBeNull();
  });
});
