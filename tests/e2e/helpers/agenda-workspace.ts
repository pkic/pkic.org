import { expect, type Page } from "@playwright/test";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";

/**
 * An event's management lives in the owning group's event workspace; `#/events/<slug>` is
 * the attendee event app for every reader, including administrators.
 */
export async function eventWorkspacePath(page: Page, slug: string): Promise<string> {
  const response = await page.request.get(`/api/v1/events/${encodeURIComponent(slug)}`);
  expect(response.status(), await response.text()).toBe(200);
  const event = eventDetailResponseSchema.parse(await response.json()).event;
  if (!("ownerGroupId" in event) || !event.ownerGroupId) throw new Error(`Event ${slug} has no group workspace`);
  return `/portal/#/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}`;
}

/** The organizer agenda in the owning group's event workspace. */
export async function agendaWorkspacePath(page: Page, slug: string): Promise<string> {
  return `${await eventWorkspacePath(page, slug)}/agenda`;
}
