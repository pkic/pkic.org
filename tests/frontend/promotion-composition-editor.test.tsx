// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { PromotionCompositionEditor } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PromotionCompositionEditor";
import { promotionKitSchema } from "../../assets/shared/schemas/event-promotion-kit";
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
it("saves personal copy and ordered panels through the canonical contract without copying speaker facts", async () => {
  const kit = promotionKitSchema.parse({
    occurrenceId: "session",
    compositionRevision: 3,
    composition: defaultPromotionComposition(),
    publishedRevision: 2,
    templateVersion: 3,
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
    metrics: { downloads: 0, clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
  });
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
      />,
      root,
    ),
  );
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
    root.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const request = promotionCompositionSaveSchema.parse(captured);
  expect(request.expectedRevision).toBe(3);
  expect(request.composition.takeaways).toHaveLength(2);
  expect(request.composition.panels).not.toContain("sponsors");
  expect(Object.keys(request)).toEqual(["expectedRevision", "composition"]);
  expect(promotionCompositionSaveSchema.safeParse({ ...request, userId: "another-user" }).success).toBe(false);
});
