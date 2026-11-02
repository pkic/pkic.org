import { expect, type Page } from "@playwright/test";
import { sponsorshipStageUpdateSchema } from "../../../assets/shared/schemas/sponsorship-management";

/**
 * End a synthetic event sponsor through the canonical stage transition.
 *
 * A synthetic sponsor has no printable logo, and every active sponsor of an event is part of that event's badges,
 * promotion kits and published sponsor wall. Ending it when its spec is done keeps those renderable, and unchanged,
 * for the specs that share the seeded event.
 */
export async function endEventSponsor(staff: Page, sponsorId: string) {
  const ended = await staff.request.patch(`/api/v1/sponsors/${sponsorId}/stage`, {
    data: sponsorshipStageUpdateSchema.parse({ toStage: "lapsed", endReason: "withdrawal" }),
  });
  expect.soft(ended.status(), await ended.text()).toBe(200);
}
