// @vitest-environment jsdom
import { PromotionTile } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PromotionTile";
import { afterEach, expect, it, vi } from "vitest";
import { exportPromotionImages } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/promotion-browser-export";
import { MyPromotionKits } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/MyPromotionKits";
import { render } from "preact";
import { act } from "preact/test-utils";
import { PersonalPromotionKit } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PersonalPromotionKit";
import { PromotionCompositionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PromotionCompositionEditor";
import {
  PROMOTION_TEMPLATE_VERSION,
  promotionKitSchema,
  promotionPdfExportSchema,
  promotionArtworkSchema,
} from "../../assets/shared/schemas/event-promotion-kit";
import {
  defaultPromotionComposition,
  promotionCompositionSaveSchema,
} from "../../assets/shared/schemas/event-promotion-design";
import { controlFor, typeInto } from "./helpers/labeled-control";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/promotion-browser-export", () => ({
  promotionArtworkUrls: vi.fn(async () => ["blob:synthetic-preview"]),
  exportPromotionImages: vi.fn(async () => new Blob(["image"], { type: "image/jpeg" })),
}));

let root: HTMLElement;
afterEach(() => {
  if (root) {
    render(null, root);
    root.remove();
  }
  vi.unstubAllGlobals();
});
const kit = promotionKitSchema.parse({
  occurrenceId: "session",
  compositionRevision: 3,
  composition: defaultPromotionComposition(),
  publishedRevision: 2,
  templateVersion: PROMOTION_TEMPLATE_VERSION,
  copy: {
    whyAttend: "The approved published session description.",
    takeaways: [],
    callToAction: "Join this session",
    campaign: "speaker-kit",
    approvedAt: null,
  },
  registrationUrl: "https://pkic.org/r/abcdefghij",
  formats: [],
  artifacts: [],
  stale: false,
  metrics: { clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
});
it("saves personal copy and ordered panels through the canonical contract without copying speaker facts", async () => {
  let captured: unknown;
  const saved = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_request, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(kit), { headers: { "content-type": "application/json" } });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(
      <PromotionCompositionEditor
        kit={kit}
        base="/api/v1/events/event/agenda/occurrences/session/promotion"
        onSaved={saved}
        onCancel={() => {}}
      />,
      root,
    ),
  );
  expect(root.querySelector("dialog form")).not.toBeNull();
  const reorder = (label: string) =>
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.getAttribute("aria-label") === label,
    )!;
  await act(() => reorder("Move cover down").click());
  expect(reorder("Move cover up").disabled).toBe(false);
  await act(() => reorder("Move cover up").click());
  expect(reorder("Move cover up").disabled).toBe(true);
  await typeInto(
    controlFor(root, "Your short description"),
    "A personal description grounded in the official abstract.",
  );
  await typeInto(
    controlFor(root, "Your key takeaways"),
    "Understand certificate lifecycle boundaries\nCompare migration approaches",
  );
  await act(() => {
    controlFor<HTMLInputElement>(root, "Sponsors").click();
  });
  await act(() => {
    controlFor<HTMLInputElement>(root, "Print option").click();
  });
  await act(() => {
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const request = promotionCompositionSaveSchema.parse(captured);
  expect(request.expectedRevision).toBe(3);
  expect(request.composition.qrCode).toBe(true);
  expect(request.composition.takeaways).toHaveLength(2);
  expect(request.composition.panels).not.toContain("sponsors");
  expect(Object.keys(request)).toEqual(["expectedRevision", "composition"]);
  expect(promotionCompositionSaveSchema.safeParse({ ...request, userId: "another-user" }).success).toBe(false);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const buttonNamed = (name: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === name || button.getAttribute("aria-label") === name,
  );

it("keeps a stale attendee draft editable while holding back renders and downloads", async () => {
  const draft = promotionKitSchema.parse({
    ...kit,
    occurrenceId: null,
    audience: "attendee",
    stale: true,
    composition: defaultPromotionComposition(true),
    compositionRevision: 1,
  });
  const fetcher = vi.fn(async (request: RequestInfo | URL, init?: RequestInit) =>
    json(
      init?.method === "POST"
        ? draft
        : String(request).includes("/sessions")
          ? { occurrences: [], page: { limit: 25, offset: 0, total: 0 } }
          : draft,
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  root = document.createElement("div");
  document.body.append(root);
  await act(() => render(<PersonalPromotionKit base="/api/v1/events/event/promotion" title="Your materials" />, root));
  await vi.waitFor(() =>
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("no longer on the agenda"),
  );
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  expect(buttonNamed("Download tall post (JPEG)")?.disabled).toBe(true);
  await act(() => buttonNamed("Customize")!.click());
  expect(root.querySelector("dialog form")).not.toBeNull();
});

it("keeps a personal editor draft through browser Back and Forward using shared dialog navigation", async () => {
  window.history.replaceState({}, "", "/portal/#/events/example/promotion");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(kit)),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(<PersonalPromotionKit base="/api/v1/events/example/promotion" title="Your materials" />, root),
  );
  await vi.waitFor(() => expect(root.querySelector("dialog")).not.toBeNull());
  await act(() => buttonNamed("Customize")!.click());
  const dialog = root.querySelector<HTMLDialogElement>("dialog")!;
  expect(dialog.open).toBe(true);
  await typeInto(controlFor(dialog, "Your short description"), "Keep this personal draft while navigating.");
  await act(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(dialog.open).toBe(false);
  await act(async () => {
    history.forward();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(dialog.open).toBe(true);
  expect(controlFor(dialog, "Your short description").value).toBe("Keep this personal draft while navigating.");
});

it("shows artwork before exports exist and generates only the requested image or PDF", async () => {
  const current = { ...kit, fingerprint: "a".repeat(64) };
  const requests: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:download");
      static revokeObjectURL = vi.fn();
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      const url = String(request);
      requests.push({ url, init });
      if (url.includes("representation=artwork")) {
        const format = new URL(url, "https://example.test").searchParams.get("format");
        return json(
          promotionArtworkSchema.parse({
            fingerprint: current.fingerprint,
            format,
            pages: [{ width: 1080, height: 1350, svg: "<svg/>" }],
            fontFiles: [],
          }),
        );
      }
      if (init?.method === "POST") {
        promotionPdfExportSchema.parse(JSON.parse(String(init.body)));
        expect(url.endsWith("/artifact")).toBe(true);
        return new Response("pdf", { headers: { "content-type": "application/pdf" } });
      }
      if (url.includes("/artifact")) return new Response("pdf", { headers: { "content-type": "application/pdf" } });
      return json(current);
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(<PersonalPromotionKit base="/api/v1/events/example/promotion" title="Your materials" />, root),
  );
  await vi.waitFor(() => expect(root.querySelectorAll(".pk-promotion-tile img")).toHaveLength(4));
  await act(() => buttonNamed("Enlarge tall post")!.click());
  expect(root.querySelector("dialog[open] img")?.getAttribute("src")).toBe("blob:synthetic-preview");
  await act(() => buttonNamed("Close preview")!.click());
  await vi.waitFor(() => expect(buttonNamed("Close preview")).toBeUndefined());
  expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(0);
  expect(
    requests.filter(({ url }) => url.includes("/artifact") && !url.includes("representation=artwork")),
  ).toHaveLength(0);
  await act(() => buttonNamed("Download tall post (JPEG)")!.click());
  await vi.waitFor(() => expect(exportPromotionImages).toHaveBeenCalledOnce());
  expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(0);
  await act(() => buttonNamed("Download carousel (PDF)")!.click());
  await vi.waitFor(() => expect(requests.filter(({ init }) => init?.method === "POST")).toHaveLength(1));
  await vi.waitFor(() =>
    expect(requests.some(({ url, init }) => url.endsWith("/artifact") && init?.method === "POST")).toBe(true),
  );
});

it("keeps previews and image downloads usable when PDF preparation fails and allows a retry", async () => {
  const current = { ...kit, fingerprint: "b".repeat(64) };
  let posts = 0;
  vi.stubGlobal(
    "URL",
    class extends URL {
      static revokeObjectURL = vi.fn();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (request: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        promotionPdfExportSchema.parse(JSON.parse(String(init.body)));
        return json({ error: { code: "FAILED", message: "Try creating your PDF again." } }, 503);
      }
      const url = new URL(String(request), "https://example.test");
      if (url.searchParams.get("representation") === "artwork")
        return json({
          fingerprint: current.fingerprint,
          format: url.searchParams.get("format"),
          pages: [{ width: 1080, height: 1350, svg: "<svg/>" }],
          fontFiles: [],
        });
      return json(current);
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(<PersonalPromotionKit base="/api/v1/events/example/promotion" title="Your materials" />, root),
  );
  await vi.waitFor(() => expect(root.querySelectorAll(".pk-promotion-tile img")).toHaveLength(4));
  await act(() => buttonNamed("Download carousel (PDF)")!.click());
  await vi.waitFor(() => expect(root.textContent).toContain("Try creating your PDF again"));
  expect(buttonNamed("Download tall post (JPEG)")?.disabled).toBe(false);
  expect(buttonNamed("Download carousel (PDF)")?.disabled).toBe(false);
  await act(() => buttonNamed("Download carousel (PDF)")!.click());
  await vi.waitFor(() => expect(posts).toBe(2));
});

it("opens Share on one gallery with the badge first and the invite link below", async () => {
  history.replaceState({}, "", "/portal/#/events/example/promotion");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(kit)),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(
      <MyPromotionKits
        slug="example"
        attendeeEligible
        speakerEligible={false}
        share={{ shareUrl: "https://example.test/r/abcdefghij", eventName: "Example event" }}
      />,
      root,
    ),
  );
  await vi.waitFor(() => expect(root.querySelectorAll(".pk-promotion-tile")).toHaveLength(5));
  expect(root.querySelector(".pk-promotion-tile__name")?.textContent).toBe("Badge");
  expect(root.querySelector("[data-og-badge-img]")).toBeNull();
  expect(root.textContent).not.toContain("Prepare downloads");
  expect(root.querySelector("table")).toBeNull();
});

it("keeps the PDF announcement region mounted before preparation starts", async () => {
  root = document.createElement("div");
  document.body.append(root);
  const props = { name: "Carousel", detail: "PDF slides", previewAlt: "Carousel preview" };
  await act(() => render(<PromotionTile {...props} />, root));
  const announcement = root.querySelector('[role="status"]');
  expect(announcement).not.toBeNull();
  expect(announcement?.textContent).toBe("");
  await act(() => render(<PromotionTile {...props} status="Preparing PDF…" />, root));
  expect(root.querySelector('[role="status"]')).toBe(announcement);
  expect(announcement?.textContent).toBe("Preparing PDF…");
});
