import { expect, type Locator, type Page } from "@playwright/test";
import { eventManagementDetailResponseSchema } from "../../../assets/shared/schemas/event-management";

/**
 * The organizer agenda workspace lives under the owning group's event record.
 * `/portal/#/events/:slug/agenda` is the attendee-facing agenda for every reader.
 */
export async function organizerAgendaPath(page: Page, slug: string): Promise<string> {
  const response = await page.request.get(`/api/v1/events/${encodeURIComponent(slug)}`);
  expect(response.status(), await response.text()).toBe(200);
  const { event } = eventManagementDetailResponseSchema.parse(await response.json());
  if (!event.ownerGroupId) throw new Error(`Event ${slug} has no owning group workspace`);
  return `/portal/#/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}/agenda`;
}

export async function openOrganizerAgenda(page: Page, slug: string): Promise<void> {
  await page.goto(await organizerAgendaPath(page, slug));
}

/** Calendar drag, resize and slot placement stay locked until the organizer explicitly enables editing. */
export async function enableAgendaEditing(page: Page, activate?: (control: Locator) => Promise<void>): Promise<void> {
  const enable = page.getByRole("button", { name: "Enable agenda editing", exact: true });
  if (activate) await activate(enable);
  else await enable.click();
  await expect(page.getByRole("button", { name: "Stop editing", exact: true })).toHaveAttribute("aria-pressed", "true");
}
