import { expect, type Page } from "@playwright/test";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";

/**
 * The organizer agenda lives in the owning group's event workspace; `#/events/<slug>/agenda`
 * is the attendee event app for every reader, including administrators.
 */
export async function agendaWorkspacePath(page: Page, slug: string): Promise<string> {
  const response = await page.request.get(`/api/v1/events/${encodeURIComponent(slug)}`);
  expect(response.status(), await response.text()).toBe(200);
  const event = eventDetailResponseSchema.parse(await response.json()).event;
  if (!("ownerGroupId" in event) || !event.ownerGroupId) throw new Error(`Event ${slug} has no group workspace`);
  return `/portal/#/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}/agenda`;
}
