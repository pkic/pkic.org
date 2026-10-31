import { MyPromotionKits } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/MyPromotionKits";
// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalPromotionKit } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PersonalPromotionKit";
import { PromotionCompositionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PromotionCompositionEditor";
import { PROMOTION_TEMPLATE_VERSION, promotionKitSchema } from "../../assets/shared/schemas/event-promotion-kit";
import {
  defaultPromotionComposition,
  promotionCompositionSaveSchema,
} from "../../assets/shared/schemas/event-promotion-design";
import { controlFor, typeInto } from "./helpers/labeled-control";
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

it("keeps a stale attendee draft editable while disabling exports", async () => {
  const draft = promotionKitSchema.parse({
    ...kit,
    occurrenceId: null,
    audience: "attendee",
    stale: true,
    composition: defaultPromotionComposition(true),
    compositionRevision: 1,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (request) =>
        new Response(
          JSON.stringify(
            String(request).includes("/sessions")
              ? { occurrences: [], page: { limit: 25, offset: 0, total: 0 } }
              : draft,
          ),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(
      <PersonalPromotionKit base="/api/v1/events/event/promotion" title="Your attendee promotion materials" />,
      root,
    ),
  );
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain("Unavailable sessions"));
  expect(
    [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Prepare downloads")
      ?.disabled,
  ).toBe(true);
  await act(() => root.querySelector<HTMLButtonElement>('[aria-label="Personalize promotion materials"]')!.click());
  expect(root.querySelector("dialog form")).not.toBeNull();
  expect(root.querySelector("a[download]")).toBeNull();
});

it("keeps a personal editor draft through browser Back and Forward using shared dialog navigation", async () => {
  window.history.replaceState({}, "", "/portal/#/events/example/promotion");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(kit), { headers: { "content-type": "application/json" } })),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(<PersonalPromotionKit base="/api/v1/events/example/promotion" title="Your materials" />, root),
  );
  await vi.waitFor(() => expect(root.querySelector("dialog")).not.toBeNull());
  await act(() => root.querySelector<HTMLButtonElement>('[aria-label="Personalize promotion materials"]')!.click());
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

it("shows prepare progress until the response and allows retry after a refusal", async () => {
  let finish!: (response: Response) => void;
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_request, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return new Response(JSON.stringify(kit), { headers: { "content-type": "application/json" } });
    }),
  );
  root = document.createElement("div");
  document.body.append(root);
  await act(() =>
    render(<PersonalPromotionKit base="/api/v1/events/example/promotion" title="Your materials" />, root),
  );
  await vi.waitFor(() => expect(root.textContent).toContain("Prepare downloads"));
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === "Prepare downloads",
  )!;
  await act(() => button.click());
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(button.querySelector(".pk-btn__spinner")).not.toBeNull();
  await act(() => button.click());
  expect(posts).toBe(1);
  await act(async () =>
    finish(
      new Response(JSON.stringify({ error: { code: "FAILED", message: "Try preparing your materials again." } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  await vi.waitFor(() => expect(root.textContent).toContain("Try preparing your materials again"));
  expect(button.hasAttribute("aria-busy")).toBe(false);
  await act(() => button.click());
  expect(posts).toBe(2);
  await act(async () => finish(new Response(JSON.stringify(kit), { headers: { "content-type": "application/json" } })));
  await vi.waitFor(() => expect(button.hasAttribute("aria-busy")).toBe(false));
});

it("keeps Share focused and opens optional materials as their own view", async () => {
  history.replaceState({}, "", "/portal/#/events/example/promotion");
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify(kit), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetcher);
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
  expect(root.querySelector("[data-og-badge-img]")).not.toBeNull();
  expect(root.textContent).not.toContain("Prepare downloads");
  expect(root.querySelector("table")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  const create = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Create promotion materials",
  )!;
  await act(() => create.click());
  await vi.waitFor(() => expect(root.textContent).toContain("Prepare downloads"));
  expect(root.querySelector("[data-og-badge-img]")).toBeNull();
  await act(async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(root.querySelector("[data-og-badge-img]")).not.toBeNull();
  expect(root.textContent).not.toContain("Prepare downloads");
});
