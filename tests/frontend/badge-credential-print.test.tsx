import { createGenericBadgeTemplate } from "../../assets/shared/badge-generic-template";
import { badgeLabelSvg } from "../../assets/shared/badge-label-svg";
// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  badgeCredentialMetadataSchema,
  badgeLabelRequestSchema,
  badgePrintResponseSchema,
  badgePrintingResponseSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { BadgeCredentials } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeCredentials";
import { BadgePrintPreview } from "../../assets/ts/components/event-badges/BadgePrintPreview";
import {
  downloadBadgeArtifact,
  type FreshBadgePrint,
} from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { memoryStorage } from "./helpers/browser-storage";

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
const printing = badgePrintingResponseSchema.parse({ revision: "0".repeat(64), template: null, branding: [] });
const printable = badgePrintResponseSchema.parse({
  id: ID,
  svg: SVG,
  firstName: "Synthetic",
  lastName: "Attendee",
  organization: null,
  badgeRole: "attendee",
  printingRevision: printing.revision,
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
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
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
        expect(path(input)).toBe("/api/v1/events/workshop/badges/labels");
        bodies.push(JSON.parse(String(init.body)));
        return json(printable);
      }
      if (path(input).endsWith("/printing")) return json(printing);
      expect(path(input)).toBe(ENDPOINT);
      return json(metadata);
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(badgeLabelRequestSchema.parse(bodies[0]).operationId).toBeTruthy();
    expect(host.textContent).not.toContain("Prepare print preview");
    expect(badgeLabelRequestSchema.parse(bodies[0])).toMatchObject({ source: "badge", badgeId: ID });
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain(metadata.displayName);
    expect(fetch).toHaveBeenCalledTimes(2);
    await click("Download print files");
    expect(host.textContent).not.toContain("Printing CSV with QR codes");
    await click("Label (SVG)");
    await rendered(() => expect(downloadBadgeArtifact).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(downloadBadgeArtifact).toHaveBeenCalledExactlyOnceWith(
      badgeLabelSvg(printable),
      "image/svg+xml",
      "attendee-badge-label.svg",
    );
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await act(async () => render(null, host));
    await mount();
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(bodies).toHaveLength(3);
  });

  it("keeps fresh issuance CSV available only when the supplied inputs contain fresh credentials", async () => {
    const issued: FreshBadgePrint = { ...printable, displayName: "Synthetic Attendee", credential: "ABCDEFGHJKLMNPQR" };
    await mount(<BadgePrintPreview badges={[issued]} printing={printing} />);
    await click("Download print files");
    await click("Printing CSV with QR codes");
    expect(downloadBadgeArtifact).toHaveBeenCalledWith(
      expect.stringContaining("ABCDEFGHJKLMNPQR"),
      "text/csv;charset=utf-8",
      "attendee-badges-print.csv",
    );
  });

  it("downloads both full-size badge faces on demand while keeping the label preview unchanged", async () => {
    const complete = badgePrintingResponseSchema.parse({
      revision: "1".repeat(64),
      template: createGenericBadgeTemplate({ eventName: "Full badge test", sponsorGroups: [] }),
      branding: [],
    });
    const load = vi.fn(async () => complete);
    const beforeRelease = vi.fn(async () => true);
    await mount(
      <BadgePrintPreview
        badges={[{ ...printable, displayName: "Synthetic Attendee" }]}
        printing={printing}
        loadPrintingContext={load}
        beforeRelease={beforeRelease}
      />,
    );
    expect(load).not.toHaveBeenCalled();
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain('class="badge-label"');
    await click("Download print files");
    await click("Full badge (HTML)");
    expect(load).toHaveBeenCalledTimes(1);
    expect(beforeRelease).toHaveBeenCalledTimes(1);
    const [html, type, filename] = vi.mocked(downloadBadgeArtifact).mock.calls[0]!;
    expect(type).toBe("text/html;charset=utf-8");
    expect(filename).toBe("attendee-badges-full.html");
    expect(html).toContain("size:105mm 148mm");
    expect(html).toContain("Full badge test");
    expect(String(html).match(/class="badge-print-sheet"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Badge front"');
    expect(html).toContain('aria-label="Badge back"');
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain('class="badge-label"');
  });

  it("switches to full artwork and its actual dimensions for browser printing", async () => {
    const complete = badgePrintingResponseSchema.parse({
      revision: "1".repeat(64),
      template: createGenericBadgeTemplate({ eventName: "Full badge test", sponsorGroups: [] }),
      branding: [],
    });
    const load = vi.fn(async () => complete);
    await mount(
      <BadgePrintPreview
        badges={[{ ...printable, displayName: "Synthetic Attendee" }]}
        printing={printing}
        loadPrintingContext={load}
      />,
    );
    await click("Print layout");
    expect(load).not.toHaveBeenCalled();
    await click("Use full badge");
    expect(load).toHaveBeenCalledTimes(1);
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("badge-template-surface");
    expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Full badge test");
    expect(button("Print badges")).toBeDefined();
  });

  it("discards full artwork if the print view closes while it is loading", async () => {
    let finish!: (value: typeof printing) => void;
    const load = vi.fn(
      () =>
        new Promise<typeof printing>((resolve) => {
          finish = resolve;
        }),
    );
    await mount(
      <BadgePrintPreview
        badges={[{ ...printable, displayName: "Synthetic Attendee" }]}
        printing={printing}
        loadPrintingContext={load}
      />,
    );
    await click("Download print files");
    await click("Full badge (HTML)");
    await act(async () => render(null, host));
    await act(async () =>
      finish(
        badgePrintingResponseSchema.parse({
          revision: "1".repeat(64),
          template: createGenericBadgeTemplate({ eventName: "Full badge test", sponsorGroups: [] }),
          branding: [],
        }),
      ),
    );
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
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

  it.each(["wrong credential", "expired badge"])("refuses %s before displaying a private artifact", async (reason) => {
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (path(_input).endsWith("/printing")) return json(printing);
        if (init?.method === "POST")
          return json({
            ...printable,
            id: reason === "wrong credential" ? OTHER : ID,
            expiresAt: reason === "expired badge" ? "2020-01-01T00:00:00.000Z" : printable.expiresAt,
          });
        reads++;
        return json(
          reads > 1 && reason === "revoked after preparation"
            ? { ...metadata, status: "revoked", reprintAvailable: false }
            : metadata,
        );
      }),
    );
    await mount();
    await rendered(() => expect(host.textContent).toContain("no longer available for printing"));
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).toContain("no longer available for printing");
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
  });

  it("retries a refused preparation with the original operation ID without replacing the badge", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (path(_input).endsWith("/printing")) return json(printing);
        if (init?.method !== "POST") return json(metadata);
        bodies.push(JSON.parse(String(init.body)));
        return bodies.length === 1
          ? json({ error: { code: "BADGE_PRINT_UNAVAILABLE", message: "Printing is temporarily unavailable." } }, 503)
          : json(printable);
      }),
    );
    await mount();
    await rendered(() => expect(host.textContent).toContain("Printing is temporarily unavailable"));
    expect(host.querySelector("img,iframe")).toBeNull();
    await click("Retry loading labels");
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(bodies.map((body) => badgeLabelRequestSchema.parse(body).operationId)).toEqual([
      badgeLabelRequestSchema.parse(bodies[0]).operationId,
      badgeLabelRequestSchema.parse(bodies[0]).operationId,
    ]);
    expect(host.querySelector("iframe")).not.toBeNull();
  });

  it.each(["sign out", "account switch", "route exit"])(
    "aborts and discards a late artifact after %s",
    async (change) => {
      let complete!: (response: Response) => void;
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          if (path(_input).endsWith("/printing")) return json(printing);
          if (init?.method !== "POST") return json(metadata);
          signal = init.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            complete = resolve;
          });
        }),
      );
      await mount();
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
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (path(_input).endsWith("/printing")) return json(printing);
        if (init?.method === "POST") badgeLabelRequestSchema.parse(JSON.parse(String(init.body)));
        return json(init?.method === "POST" ? printable : metadata);
      }),
    );
    await mount();
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(host.querySelector("iframe")).not.toBeNull();
    await act(async () => clearAuth());
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).toContain("Sign in again");
  });

  it("blocks download after a fresh canonical print refusal and clears the preview", async () => {
    let posts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (path(_input).endsWith("/printing")) return json(printing);
        if (init?.method === "POST") {
          badgeLabelRequestSchema.parse(JSON.parse(String(init.body)));
          posts++;
          return posts > 1
            ? json({ error: { code: "BADGE_PRINT_UNAVAILABLE", message: "Badge was revoked." } }, 409)
            : json(printable);
        }
        return json(metadata);
      }),
    );
    await mount();
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    await click("Download print files");
    await click("Label (SVG)");
    await rendered(() => expect(host.querySelector("img,iframe")).toBeNull());
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(downloadBadgeArtifact).not.toHaveBeenCalled();
  });

  it("clears the private preview at credential expiry without a network request", async () => {
    vi.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (path(_input).endsWith("/printing")) return json(printing);
      if (init?.method === "POST") badgeLabelRequestSchema.parse(JSON.parse(String(init.body)));
      return json(init?.method === "POST" ? { ...printable, expiresAt } : { ...metadata, expiresAt });
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    await rendered(() => expect(host.querySelector("iframe")).not.toBeNull());
    expect(host.querySelector("iframe")).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(host.querySelector("img,iframe")).toBeNull();
    expect(host.textContent).toContain("has expired");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
