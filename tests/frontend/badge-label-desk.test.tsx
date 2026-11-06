import { createGenericBadgeTemplate } from "../../assets/shared/badge-generic-template";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { BadgeLabelDesk } from "../../assets/ts/member-flows/portal/sections/events/detail/badges/BadgeLabelDesk";
import { clearAuth, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import { memoryStorage } from "./helpers/browser-storage";
import {
  badgeLabelRequestSchema,
  badgePrintingResponseSchema,
  badgePrintResponseSchema,
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
} from "../../assets/shared/schemas/route-contracts-event-badges";
import { badgeLabelDeskSection } from "../../assets/ts/ui/preview/badge-label-desk";
import { printBadgeDocument } from "../../assets/ts/components/event-badges/badge-print-command";
import { badgePrintPdf } from "../../assets/ts/components/event-badges/badge-print-pdf";
vi.mock("../../assets/ts/components/event-badges/badge-print-pdf", () => ({
  badgePrintPdf: vi.fn(async () => new Blob(["synthetic PDF"], { type: "application/pdf" })),
}));
vi.mock("../../assets/ts/components/event-badges/badge-print-command", () => ({
  printBadgeDocument: vi.fn(async () => {}),
}));

const capture = vi.hoisted(() => ({
  read: null as null | ((raw: string) => void),
  starts: 0,
  ready: null as null | (() => void),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/camera-driver", () => ({
  openBadgeCamera: vi.fn(async (_video, onCode, onActive, registerStop) => {
    capture.read = onCode;
    capture.starts++;
    registerStop(() => onActive(false));
    onActive(true);
  }),
}));
vi.mock("../../assets/ts/components/event-badges/BadgeDocumentFrame", () => ({
  BadgeDocumentFrame: (props: {
    frameRef: { current: HTMLIFrameElement | null };
    html: string;
    title: string;
    onReady: () => void;
  }) => {
    capture.ready = props.onReady;
    return <iframe ref={props.frameRef} title={props.title} srcDoc={props.html} />;
  },
}));
const ID = "60000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000001";
const label = badgePrintResponseSchema.parse({
  id: ID,
  displayName: "Ada Lovelace",
  firstName: "Ada",
  lastName: "Lovelace",
  jobTitle: "Researcher",
  organization: "Synthetic Labs",
  badgeRole: "attendee",
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29"><path d="M4 4h7v7H4z"/></svg>',
  printingRevision: "0".repeat(64),
  expiresAt: "2099-01-01T00:00:00.000Z",
});
let host: HTMLDivElement;
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
async function settle(assertion: () => void) {
  await vi.waitFor(async () => {
    await act(async () => {
      await Promise.resolve();
    });
    assertion();
  });
}
async function click(name: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
  );
  expect(target, name).toBeDefined();
  await act(async () => target!.click());
}
async function mount() {
  await act(async () => render(<BadgeLabelDesk slug="workshop" />, host));
}
async function scan(raw = "ABCDEFGHJKLMNPQR") {
  await act(async () => capture.read!(raw));
}
function pages() {
  return (
    host
      .querySelector("iframe")
      ?.getAttribute("srcdoc")
      ?.match(/class="badge-print-sheet"/g)?.length ?? 0
  );
}
async function openDialog() {
  const frame = host.querySelector("iframe")!;
  vi.mocked(printBadgeDocument).mockClear();
  await act(async () => capture.ready!());
  expect(printBadgeDocument).toHaveBeenCalledOnce();
  return frame;
}
beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  clearAuth();
  savePortalSession(portalSessionFixture({ member: true }));
  window.location.hash = "#/groups/example/events/workshop/scanner/print";
  capture.read = null;
  capture.starts = 0;
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(async () => render(null, host));
  host.remove();
  clearAuth();
  vi.unstubAllGlobals();
});

describe("badge printing desk", () => {
  it("retains the camera when switching views, and Escape closes the full-screen scanner", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ released: false, release, addEventListener: vi.fn() }));
    vi.stubGlobal("navigator", Object.create(navigator, { wakeLock: { value: { request } } }));
    await mount();
    await click("Start camera");
    const video = host.querySelector("video");
    await click("Enter full screen");
    await settle(() => expect(host.textContent).toContain("Screen awake"));
    expect(request).toHaveBeenCalledWith("screen");
    expect(host.querySelector('[role="dialog"][aria-label="Badge printing scanner"]')).not.toBeNull();
    expect(host.querySelector("video")).toBe(video);
    expect(capture.starts).toBe(1);
    await click("Find attendee or badge");
    expect(release).toHaveBeenCalled();
    expect(host.querySelector("video")).toBe(video);
    expect(capture.starts).toBe(1);
    await click("Enter full screen");
    await act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(host.querySelector('[aria-label="Badge printing scanner"]')).toBeNull();
    expect(document.body.classList.contains("pk-scanner-immersive")).toBe(false);
  });
  it("prepares the optional PDF without opening HTML printing or waiting for afterprint", async () => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL() {
          return "blob:synthetic-pdf";
        }
        static revokeObjectURL() {}
      },
    );
    window.location.hash = "#/groups/example/events/workshop/scanner/print";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(label)),
    );
    vi.mocked(printBadgeDocument).mockClear();
    vi.mocked(badgePrintPdf).mockClear();
    await mount();
    await click("Print settings");
    await click("Use PDF");
    expect(window.location.hash).toContain("printFormat=pdf");
    await click("Start camera");
    await scan();
    await settle(() => expect(host.querySelector("iframe")).not.toBeNull());
    await act(async () => capture.ready!());
    await settle(() => expect(host.textContent).toContain("Open PDF"));
    expect(badgePrintPdf).toHaveBeenCalledOnce();
    expect(printBadgeDocument).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Download PDF");
    expect(host.querySelector('input[aria-autocomplete="list"]')?.hasAttribute("disabled")).toBe(false);
  });
  it("scans directly into two label pages without issuance or complete artwork, then suppresses the same ticket", async () => {
    const bodies: unknown[] = [];
    const fetch = vi.fn(async (input, init) => {
      expect(String(input)).toBe("/api/v1/events/workshop/badges/labels");
      bodies.push(JSON.parse(String(init?.body)));
      return json(label);
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    await click("Start camera");
    await scan();
    await settle(() => expect(pages()).toBe(2));
    expect(badgeLabelRequestSchema.parse(bodies[0])).toMatchObject({ source: "scan", credential: "ABCDEFGHJKLMNPQR" });
    const frame = await openDialog();
    expect(frame.srcdoc).toContain("@page{size:38mm 89.8mm;margin:0}");
    expect(frame.srcdoc).not.toContain("105mm 148mm");
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await scan();
    expect(fetch).toHaveBeenCalledOnce();
    expect(capture.starts).toBe(2);
    expect(host.textContent).not.toContain("Two labels per attendee. Printing opens");
  });
  it("uses the configured number of individual labels and restores it through the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(label)),
    );
    await mount();
    await click("Print settings");
    await click("4 labels");
    expect(window.location.hash).toContain("labelCopies=4");
    await click("Start camera");
    await scan();
    await settle(() => expect(pages()).toBe(4));
    await act(async () => render(null, host));
    await mount();
    await click("Print settings");
    expect(
      [...host.querySelectorAll('[role="menuitemradio"][aria-checked="true"]')].some((item) =>
        item.textContent?.includes("4 labels"),
      ),
    ).toBe(true);
  });
  it("switches scanned tickets to full badges, uses side selection, and switches back to labels", async () => {
    const complete = badgePrintingResponseSchema.parse({
      revision: "1".repeat(64),
      template: createGenericBadgeTemplate({ eventName: "Synthetic full badge", sponsorGroups: [] }),
      branding: [],
    });
    let artworkReads = 0;
    const fetch = vi.fn(async (input, init) => {
      if (String(input).endsWith("/printing")) {
        artworkReads++;
        return json(complete);
      }
      badgeLabelRequestSchema.parse(JSON.parse(String(init?.body)));
      return json(label);
    });
    vi.stubGlobal("fetch", fetch);
    await mount();
    expect(artworkReads).toBe(0);
    await click("Print settings");
    await click("4 labels");
    await click("Print settings");
    await click("Full badges");
    await settle(() => expect(artworkReads).toBe(1));
    expect(window.location.hash).toContain("printDesign=event_badge");
    await click("Start camera");
    await scan();
    await settle(() => expect(pages()).toBe(2));
    expect(host.querySelector("iframe")?.title).toBe("Attendee badge print document");
    const frame = await openDialog();
    expect(frame.srcdoc).toContain("@page{size:105mm 148mm;margin:0}");
    expect(frame.srcdoc).toContain("Synthetic full badge");
    expect(frame.srcdoc).toContain('aria-label="Badge front"');
    expect(frame.srcdoc).toContain('aria-label="Badge back"');
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await click("Print settings");
    expect(host.textContent).not.toContain("4 labels");
    await click("Front only");
    await click("Print badges again");
    await settle(() => expect(pages()).toBe(1));
    expect(host.querySelector("iframe")?.srcdoc).toContain('aria-label="Badge front"');
    expect(host.querySelector("iframe")?.srcdoc).not.toContain('aria-label="Badge back"');
    await openDialog();
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    await click("Print settings");
    await click("Back only");
    await click("Print badges again");
    await settle(() => expect(pages()).toBe(1));
    expect(host.querySelector("iframe")?.srcdoc).toContain('aria-label="Badge back"');
    expect(host.querySelector("iframe")?.srcdoc).not.toContain('aria-label="Badge front"');
    await openDialog();
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(artworkReads).toBe(1);
    await click("Print settings");
    await click("Labels");
    await click("Print labels again");
    await settle(() => expect(pages()).toBe(4));
    expect(host.querySelector("iframe")?.srcdoc).toContain("@page{size:38mm 89.8mm;margin:0}");
    expect(host.querySelector("iframe")?.srcdoc).not.toContain("Synthetic full badge");
    expect(artworkReads).toBe(1);
  });
  it("restores full-badge printing and its selected side from the URL", async () => {
    window.location.hash += "?printDesign=event_badge&badgeSides=back";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        if (String(input).endsWith("/printing"))
          return json({
            revision: "1".repeat(64),
            template: createGenericBadgeTemplate({ eventName: "Synthetic full badge", sponsorGroups: [] }),
            branding: [],
          });
        badgeLabelRequestSchema.parse(JSON.parse(String(init?.body)));
        return json(label);
      }),
    );
    await mount();
    await click("Start camera");
    await scan();
    await settle(() => expect(pages()).toBe(1));
    expect(host.querySelector("iframe")?.title).toBe("Attendee badge print document");
  });
  it("discards delayed full artwork after sign-out", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        if (String(input).endsWith("/printing"))
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        badgeLabelRequestSchema.parse(JSON.parse(String(init?.body)));
        return json(label);
      }),
    );
    await mount();
    await click("Print settings");
    await click("Full badges");
    await click("Start camera");
    await scan();
    await act(async () => clearAuth());
    await act(async () =>
      finish(
        json({
          revision: "1".repeat(64),
          template: createGenericBadgeTemplate({ eventName: "Synthetic full badge", sponsorGroups: [] }),
          branding: [],
        }),
      ),
    );
    expect(host.querySelector("iframe")).toBeNull();
  });
  it("searches registered attendees and reuses their active badge before printing only labels", async () => {
    const issued: unknown[] = [],
      printed: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, init) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname.endsWith("/attendees")) {
          expect(url.searchParams.get("q")).toBe("Synthetic Labs");
          expect(url.searchParams.get("limit")).toBe("8");
          return json(
            badgeAttendeesResponseSchema.parse({
              users: [
                {
                  id: USER,
                  email: "ada@example.test",
                  first_name: "Ada",
                  last_name: "Lovelace",
                  organization_name: "Synthetic Labs",
                },
              ],
              page: { limit: 8, offset: 0, total: 1, hasMore: false },
            }),
          );
        }
        const body = JSON.parse(String(init?.body));
        if (url.pathname.endsWith("/labels")) {
          printed.push(body);
          return json(label);
        }
        issued.push(body);
        return json({
          id: ID,
          result: "existing",
          credential: null,
          expiresAt: label.expiresAt,
          replacedBadgeId: null,
        });
      }),
    );
    await mount();
    const search = host.querySelector<HTMLInputElement>('input[aria-autocomplete="list"]')!;
    await act(async () => {
      search.value = "Synthetic Labs";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle(() => expect(host.querySelector('[aria-label="Matching attendees"] button')).not.toBeNull());
    await act(async () =>
      (host.querySelector('[aria-label="Matching attendees"] button') as HTMLButtonElement).click(),
    );
    await settle(() => expect(pages()).toBe(2));
    expect(badgeIssueRequestSchema.parse(issued[0])).toMatchObject({ userId: USER, reuseActive: true });
    expect(badgeLabelRequestSchema.parse(printed[0])).toMatchObject({ source: "badge", badgeId: ID });
    await openDialog();
  });
  it("discards a delayed label after sign-out", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Promise<Response>((resolve) => {
            complete = resolve;
          }),
      ),
    );
    await mount();
    await click("Start camera");
    await scan();
    await act(async () => clearAuth());
    await act(async () => complete(json(label)));
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.textContent).toContain("Sign in again");
  });
  it("keeps the gallery on the same single-heading surface without the removed footer", async () => {
    await act(async () => render(badgeLabelDeskSection.render(), host));
    expect(host.querySelectorAll("h1,h2")).toHaveLength(1);
    expect(host.textContent).not.toContain("phone’s print dialog");
    expect(host.textContent).not.toContain("Brother");
  });
});
