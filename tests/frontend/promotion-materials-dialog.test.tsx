// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { PromotionMaterialsDialog } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/PromotionMaterialsDialog";
import { PROMOTION_TEMPLATE_VERSION, promotionKitSchema } from "../../assets/shared/schemas/event-promotion-kit";
import { defaultPromotionComposition } from "../../assets/shared/schemas/event-promotion-design";
import { json } from "./helpers/event-email-campaign";

vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/promotion-browser-export", () => ({
  promotionArtworkUrls: vi.fn(async () => ["blob:synthetic-preview"]),
  exportPromotionImages: vi.fn(async () => new Blob(["image"], { type: "image/jpeg" })),
}));

const kit = promotionKitSchema.parse({
  occurrenceId: null,
  compositionRevision: 1,
  composition: defaultPromotionComposition(),
  publishedRevision: 1,
  templateVersion: PROMOTION_TEMPLATE_VERSION,
  copy: { whyAttend: "", takeaways: [], callToAction: "Join this event", campaign: "attendee-kit", approvedAt: null },
  registrationUrl: "https://pkic.org/r/abcdefghij",
  formats: [],
  artifacts: [],
  stale: false,
  metrics: { clicks: 0, confirmedRegistrations: 0, sessionRsvps: 0 },
});

let root: HTMLElement | undefined;
afterEach(() => {
  if (root) render(null, root);
  root?.remove();
  vi.unstubAllGlobals();
});

it("selects every ready file with Select all and clears the selection again", async () => {
  history.replaceState({}, "", "/portal/#/groups/g/events/e/registrations");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/agenda/promotion")
        ? json({ occurrences: [], page: { limit: 50, offset: 0, total: 0, hasMore: false }, attendeeEligible: true })
        : json(kit),
    ),
  );
  root = document.createElement("div");
  document.body.append(root);
  // A file picked earlier keeps its place even before its card is ready.
  await act(() =>
    render(
      <PromotionMaterialsDialog
        slug="example"
        userId="user-1"
        initialSelected={["attendee:square"]}
        onClose={() => {}}
        onEmail={() => {}}
      />,
      root!,
    ),
  );
  const selectAll = await vi.waitFor(() => {
    const box = [...root!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find(
      (input) => input.closest("label")?.textContent === "Select all",
    );
    expect(box?.disabled).toBe(false);
    return box!;
  });
  const status = () => root!.querySelector(".pk-dialog__foot-status")?.textContent;
  const ready = root.querySelectorAll(".pk-promotion-tile input[type=checkbox]:not(:disabled)").length;
  expect(ready).toBeGreaterThan(0);
  expect(selectAll.checked).toBe(false);
  expect(selectAll.indeterminate).toBe(true);

  await act(() => {
    selectAll.click();
  });
  expect(selectAll.checked).toBe(true);
  expect(status()).toBe(`${ready + 1} selected`);

  await act(() => {
    selectAll.click();
  });
  expect(selectAll.checked).toBe(false);
  expect(selectAll.indeterminate).toBe(false);
  expect(status()).toBe("Select the files to download or email");
});
