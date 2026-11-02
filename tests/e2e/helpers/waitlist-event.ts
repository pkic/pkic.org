import type { Page } from "@playwright/test";
import type { z } from "zod";
import { dateTimeLocalToIso } from "../../../assets/shared/timezone";
import {
  groupEventCreateSchema,
  groupEventDetailResponseSchema,
  groupEventTermsReplaceSchema,
  groupEventTermsReplaceResponseSchema,
  groupEventDaysReplaceSchema,
  groupEventDaysReplaceResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
  groupEventRegistrationSettingsResponseSchema,
} from "../../../assets/shared/schemas/group-events";

/** Create the public capacity fixture through the same contracts and routes as the portal. */
export async function createPortalWaitlistEvent(page: Page, slug: string, dayDates?: readonly string[]) {
  const dates = dayDates ?? ["2026-12-01", "2026-12-02", "2026-12-03"];
  const groupId = "20000000-0000-4000-8000-000000000001";
  const base = `/api/v1/groups/${groupId}/events`;
  async function mutate<Request extends z.ZodType, Response extends z.ZodType>(
    path: string,
    method: "POST" | "PUT",
    request: Request,
    body: z.input<Request>,
    response: Response,
  ): Promise<z.output<Response>> {
    const result = await page.request.fetch(path, {
      method,
      data: request.parse(body),
      headers: { origin: new URL(page.url()).origin },
    });
    if (!result.ok())
      throw new Error(`Waitlist fixture ${method} ${path} failed (${result.status()}): ${await result.text()}`);
    return response.parse(await result.json());
  }
  const created = await mutate(
    base,
    "POST",
    groupEventCreateSchema,
    {
      slug,
      name: `E2E waitlist event ${slug}`,
      timezone: "Europe/Amsterdam",
      // An hour after the seeded conference opens: an equal start would tie, and the id tie-break would then
      // randomly put this fixture ahead of the conference in "next event" listings such as portal Home.
      startsAt: dateTimeLocalToIso(`${dates[0]}T${dayDates ? "00:00" : "10:00"}`, "Europe/Amsterdam"),
      endsAt: dateTimeLocalToIso(`${dates.at(-1)}T${dayDates ? "23:59" : "17:00"}`, "Europe/Amsterdam"),
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      visibility: "public",
      inviteLimitAttendee: 5,
    },
    groupEventDetailResponseSchema,
  );
  const eventId = created.event.id;
  const terms = await mutate(
    `${base}/${eventId}/terms`,
    "PUT",
    groupEventTermsReplaceSchema,
    {
      expectedUpdatedAt: created.event.updatedAt,
      configuration: {
        attendee: [
          { termKey: "privacy_policy", version: "1", required: true, displayText: "I agree to the privacy policy" },
          { termKey: "code_of_conduct", version: "1", required: true, displayText: "I agree to the code of conduct" },
          { termKey: "photos_and_videos", version: "1", required: true, displayText: "I agree to photos and videos" },
        ],
        speaker: [],
      },
    },
    groupEventTermsReplaceResponseSchema,
  );
  const days = await mutate(
    `${base}/${eventId}/days`,
    "PUT",
    groupEventDaysReplaceSchema,
    {
      expectedUpdatedAt: terms.eventUpdatedAt,
      configuration: {
        days: dates.map((date, index) => ({
          date,
          label: dayDates ? "Scanner day" : `${["Tuesday", "Wednesday", "Thursday"][index]} ${index + 1} December 2026`,
          startTime: "10:00",
          endTime: "17:00",
          sortOrder: index,
          attendanceOptions:
            index === 0
              ? [
                  { value: "in_person", label: "In person", capacity: 1 },
                  { value: "on_demand", label: "On demand" },
                ]
              : [{ value: "on_demand", label: "On demand" }],
        })),
      },
    },
    groupEventDaysReplaceResponseSchema,
  );
  await mutate(
    `${base}/${eventId}/registration-settings`,
    "PUT",
    groupEventRegistrationSettingsUpdateSchema,
    {
      expectedUpdatedAt: days.eventUpdatedAt,
      registrationPolicy: "public",
    },
    groupEventRegistrationSettingsResponseSchema,
  );
  return { eventId, slug, groupId };
}
