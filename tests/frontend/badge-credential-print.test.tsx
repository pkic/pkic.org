// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  badgeCredentialMetadataSchema,
  badgePrintRequestSchema,
  badgePrintResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { BadgeCredentials } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeCredentials";
import { BadgePrintPreview } from "../../assets/ts/components/event-badges/BadgePrintPreview";
import {
  downloadBadgeArtifact,
  type FreshBadgePrint,
} from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
vi.mock("../../assets/ts/components/event-badges/badge-print-artifacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/components/event-badges/badge-print-artifacts")>()),
  downloadBadgeArtifact: vi.fn(),
}));

const ID = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const BASE = "/groups/example/events/workshop/registrations/badges";
const ENDPOINT = `/api/v1/events/workshop/badges/${ID}`;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>';
const metadata = badgeCredentialMetadataSchema.parse({
  id: ID,
  eventId: "10000000-0000-4000-8000-000000000003",
  userId: "10000000-0000-4000-8000-000000000004",
  displayName: "Synthetic Attendee",
  createdAt: "2026-10-07T10:00:00.000Z",
  expiresAt: "2099-01-01T00:00:00.000Z",
  revokedAt: null,
  status: "active",
  reprintAvailable: true,
});
const printable = badgePrintResponseSchema.parse({
  id: ID,
  svg: SVG,
  expiresAt: metadata.expiresAt,
  displayName: metadata.displayName,
});
let host: HTMLDivElement;
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
async function mount(
  node: ComponentChildren = <BadgeCredentials slug="workshop" basePath={BASE} credentialId={ID} segment="print" />,
) {
  await act(async () => render(node, host));
  await rendered(() => expect(host.textContent).not.toContain("Loading badge credential…"));
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function rendered(assertion: () => void) {
  await vi.waitFor(async () => {
    await settle();
    assertion();
  });
}
function button(label: string) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  expect(result, label).toBeDefined();
  return result!;
}
async function click(label: string, leavePending = false) {
  await act(async () => button(label).click());
  await settle();
  if (label === "Prepare print preview" && !leavePending)
    await rendered(() => expect(host.textContent).not.toContain("Preparing print preview…"));
}
function path(input: RequestInfo | URL) {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin)
    .pathname;
}
function browserStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
beforeEach(() => {
  vi.stubGlobal("localStorage", browserStorage());
  vi.stubGlobal("sessionStorage", browserStorage());
  clearAuth();
  savePortalSession(portalSessionFixture({ member: true }));
  navigate.mockReset();
  vi.mocked(downloadBadgeArtifact).mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => render(null, host));
  host.remove();
  clearAuth();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authorized badge reprinting", () => {
  it("opens the dedicated print view from the selected active record without retrieving a code", async () => {
    const fetch = vi.fn(async () => json(metadata));
    vi.stubGlobal("fetch", fetch);
    await mount(<BadgeCredentials slug="workshop" basePath={BASE} credentialId={ID} />);
    expect(host.querySelector("img,iframe")).toBeNull();
    await click("Record actions");
    await click("Reprint badge");
    expect(navigate).toHaveBeenCalledWith(`${BASE}/${ID}/print`);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("prepares the same credential through the canonical request, rechecks release, and never offers a raw-code CSV", async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(path(input)).toBe(`${ENDPOINT}/print`);
        bodies.push(JSON.parse(String(init.body)));
        return json(printable);
      }
      expect(path(input)).toBe(ENDPOINT);
      return json(metadata);
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.querySelector("img,iframe")).toBeNull();
    await click("Prepare print preview");
    expect(badgePrintRequestSchema.parse(bodies[0]).operationId).toBeTruthy();
    const preview = host.querySelector<HTMLImageElement>("img")!;
    expect(decodeURIComponent(preview.src)).toContain(SVG);
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain(metadata.displayName);
    expect(fetch).toHaveBeenCalledTimes(3);
    await click("Download print files");
    expect(host.textContent).not.toContain("Printing CSV with QR codes");
    await click("QR code (SVG)");
    await rendered(() => expect(downloadBadgeArtifact).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(downloadBadgeArtifact).toHaveBeenCalledExactlyOnceWith(SVG, "image/svg+xml", "attendee-badge-qr.svg");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await act(async () => render(null, host));
    await mount();
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(bodies).toHaveLength(1);
  });

  it("keeps fresh issuance CSV available only when the supplied inputs contain fresh credentials", async () => {
    const issued: FreshBadgePrint = { ...printable, displayName: "Synthetic Attendee", credential: OTHER };
    await mount(<BadgePrintPreview badges={[issued]} />);
    await click("Download print files");
    await click("Printing CSV with QR codes");
    expect(downloadBadgeArtifact).toHaveBeenCalledWith(
      expect.stringContaining(OTHER),
      "text/csv;charset=utf-8",
      "attendee-badges-print.csv",
    );
  });

  it("explains unavailable legacy credentials and makes no print request", async () => {
    const fetch = vi.fn(async () => json({ ...metadata, reprintAvailable: false }));
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(host.textContent).toContain("Reprinting is unavailable for this credential");
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).not.toContain("Prepare print preview");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["wrong credential", "revoked after preparation"])(
    "refuses %s before displaying a private artifact",
    async (reason) => {
      let reads = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method === "POST") return json({ ...printable, id: reason === "wrong credential" ? OTHER : ID });
          reads++;
          return json(
            reads > 1 && reason === "revoked after preparation"
              ? { ...metadata, status: "revoked", reprintAvailable: false }
              : metadata,
          );
        }),
      );
      await mount();
      await click("Prepare print preview");
      expect(host.querySelector("img,iframe")).toBeNull();
      expect(host.textContent).toContain("no longer available for printing");
      expect(downloadBadgeArtifact).not.toHaveBeenCalled();
    },
  );

  it("retries a refused preparation with the original operation ID without replacing the badge", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method !== "POST") return json(metadata);
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1
          ? json({ error: { code: "BADGE_PRINT_UNAVAILABLE", message: "Printing is temporarily unavailable." } }, 503)
          : json(printable);
      }),
    );
    await mount();
    await click("Prepare print preview");
    expect(host.querySelector("img,iframe")).toBeNull();
    await click("Prepare print preview");
    expect(bodies.map((body) => badgePrintRequestSchema.parse(body).operationId)).toEqual([
      badgePrintRequestSchema.parse(bodies[0]).operationId,
      badgePrintRequestSchema.parse(bodies[0]).operationId,
    ]);
    expect(host.querySelector("img")).not.toBeNull();
  });

  it.each(["sign out", "account switch", "route exit"])(
    "aborts and discards a late artifact after %s",
    async (change) => {
      let complete!: (response: Response) => void;
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (init?.method !== "POST") return json(metadata);
          signal = init.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            complete = resolve;
          });
        }),
      );
      await mount();
      await click("Prepare print preview", true);
      await rendered(() => expect(complete).toBeTypeOf("function"));
      await act(async () => {
        if (change === "sign out") clearAuth();
        else if (change === "account switch") {
          const next = portalSessionFixture({ member: true });
          next.sessionId = OTHER;
          next.identity = { id: OTHER, email: "other@example.test" };
          savePortalSession(next);
        } else render(null, host);
      });
      expect(signal?.aborted).toBe(true);
      await act(async () => complete(json(printable)));
      await settle();
      expect(host.querySelector("img,iframe")).toBeNull();
      expect(downloadBadgeArtifact).not.toHaveBeenCalled();
    },
  );

  it("purges an already displayed preview on sign-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        json(init?.method === "POST" ? printable : metadata),
      ),
    );
    await mount();
    await click("Prepare print preview");
    expect(host.querySelector("img")).not.toBeNull();
    await act(async () => clearAuth());
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).toContain("Sign in again");
  });

  it("blocks download after a fresh revocation read and clears the preview", async () => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return json(printable);
        reads++;
        return json(reads > 2 ? { ...metadata, status: "revoked", reprintAvailable: false } : metadata);
      }),
    );
    await mount();
    await click("Prepare print preview");
    await click("Download print files");
    await click("QR code (SVG)");
    await rendered(() => expect(host.querySelector("img,iframe")).toBeNull());
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
  });

  it("clears the private preview at credential expiry without a network request", async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      json(init?.method === "POST" ? { ...printable, expiresAt } : { ...metadata, expiresAt }),
    );
    vi.stubGlobal("fetch", fetch);
    await mount();
    await click("Prepare print preview");
    expect(host.querySelector("img")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).toContain("has expired");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
