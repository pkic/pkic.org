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
