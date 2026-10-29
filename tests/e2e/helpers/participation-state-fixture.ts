import { expect, type Page } from "@playwright/test";
import type { z } from "zod";
import { eventDetailResponseSchema } from "../../../assets/shared/schemas/event-management";
import { eventFormsResponseSchema } from "../../../assets/shared/schemas/forms";
import {
  groupEventCreateSchema,
  groupEventDetailResponseSchema,
  groupEventDaysReplaceSchema,
  groupEventDaysReplaceResponseSchema,
  groupEventTermsReplaceSchema,
  groupEventTermsReplaceResponseSchema,
  groupEventRegistrationSettingsUpdateSchema,
  groupEventRegistrationSettingsResponseSchema,
} from "../../../assets/shared/schemas/group-events";
import {
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../../../assets/shared/schemas/event-agenda";
import {
  registrationConfirmQuerySchema,
  registrationConfirmResponseSchema,
  registrationConfirmSchema,
  registrationCreateSchema,
  registrationSubmissionResponseSchema,
} from "../../../assets/shared/schemas/registration";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { clientIpForIdentity } from "./portal-auth";
import { publishE2eSite } from "./site-publication";
import { confirmRegistration } from "./registration";

/** The single day a fixture event runs, as UTC wall-clock times. */
interface FixtureEventDay {
  date: string;
  startTime: string;
  endTime: string;
  attendanceOptions?: import("../../../assets/shared/schemas/event-configuration").EventAttendanceOption[];
}

const WORKSHOP_DAY: FixtureEventDay = { date: "2027-09-10", startTime: "09:00", endTime: "17:00" };

/** A fresh public event with open registration, independent from other agenda tests. */
export async function createRegistrationEvent(
  staff: Page,
  prefix: string,
  day: FixtureEventDay | FixtureEventDay[] = WORKSHOP_DAY,
) {
  const days = Array.isArray(day) ? day : [day];
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const ownerResponse = await staff.request.get("/api/v1/events/pqc-conference-amsterdam-nl");
  expect(ownerResponse.status()).toBe(200);
  const owner = eventDetailResponseSchema.parse(await ownerResponse.json()).event;
  if (!("ownerGroupId" in owner) || !owner.ownerGroupId) throw new Error("Public conference owner missing");
  const slug = `${prefix}-${crypto.randomUUID()}`;
  const groupBase = `/api/v1/groups/${owner.ownerGroupId}/events`;
  const created = await staff.request.post(groupBase, {
    data: groupEventCreateSchema.parse({
      slug,
      name: "Synthetic participant status workshop",
      profileKey: "conference",
      timezone: "UTC",
      visibility: "public",
      registrationPolicy: "no_registration",
      startsAt: `${firstDay.date}T${firstDay.startTime}:00.000Z`,
      endsAt: `${lastDay.date}T${lastDay.endTime}:00.000Z`,
    }),
  });
  expect(created.status()).toBe(201);
  const event = groupEventDetailResponseSchema.parse(await created.json()).event;
  const groupEvent = `${groupBase}/${event.id}`;
  const terms = await staff.request.put(`${groupEvent}/terms`, {
    data: groupEventTermsReplaceSchema.parse({
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        attendee: [
          { termKey: "privacy_policy", version: "1", required: true, displayText: "I agree to the privacy policy" },
          { termKey: "code_of_conduct", version: "1", required: true, displayText: "I agree to the code of conduct" },
        ],
        speaker: [],
      },
    }),
  });
  expect(terms.status()).toBe(200);
  const configuredTerms = groupEventTermsReplaceResponseSchema.parse(await terms.json());
  const daysResponse = await staff.request.put(`${groupEvent}/days`, {
    data: groupEventDaysReplaceSchema.parse({
      expectedUpdatedAt: configuredTerms.eventUpdatedAt,
      configuration: {
        days: days.map((day, index) => ({
          date: day.date,
          label: days.length === 1 ? "Workshop day" : `Workshop day ${index + 1}`,
          startTime: day.startTime,
          endTime: day.endTime,
          sortOrder: index,
          attendanceOptions: day.attendanceOptions ?? [{ value: "in_person", label: "In person" }],
        })),
      },
    }),
  });
  expect(daysResponse.status()).toBe(200);
  const configuredDays = groupEventDaysReplaceResponseSchema.parse(await daysResponse.json());
  const registration = await staff.request.put(`${groupEvent}/registration-settings`, {
    data: groupEventRegistrationSettingsUpdateSchema.parse({
      expectedUpdatedAt: configuredDays.eventUpdatedAt,
      registrationPolicy: "public",
    }),
  });
  expect(registration.status()).toBe(200);
  groupEventRegistrationSettingsResponseSchema.parse(await registration.json());
  return { slug, eventId: event.id };
}

/** A fresh public event keeps the state journey independent from other agenda tests. */
export async function prepareParticipationStates(staff: Page) {
  const { slug, eventId } = await createRegistrationEvent(staff, "participation-states");
  const base = `/api/v1/events/${slug}/agenda`;
  let agenda = agendaSnapshotSchema.parse(await (await staff.request.get(base)).json());
  const roomResponse = await staff.request.post(`${base}/rooms`, {
    data: agendaRoomCreateSchema.parse({
      expectedRevision: agenda.revision,
      name: "Synthetic workshop hall",
      capacity: 20,
    }),
  });
  expect(roomResponse.status()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await roomResponse.json());
  const room = agenda.rooms[0]!;
  const closedAt = new Date(Date.now() - 3_600_000).toISOString();
  for (const [index, title] of [
    "Reservation workshop",
    "Approval workshop",
    "Invitation workshop",
    "Closed workshop",
  ].entries()) {
    const response = await staff.request.post(`${base}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: agenda.revision,
        title,
        description:
          "A synthetic public workshop demonstrating current participation choices and their distinct outcomes.",
        startAt: `2027-09-10T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
        endAt: `2027-09-10T${String(10 + index).padStart(2, "0")}:00:00.000Z`,
        roomId: room.id,
        admissionPolicy: index === 1 ? "approval" : "reservation",
        accessPolicy: index === 2 ? "invitation" : "open",
        capacity: index === 0 ? 1 : 20,
        bookingClosesAt: index === 3 ? closedAt : null,
        speakerUserIds: [],
      }),
    });
    expect(response.status()).toBe(200);
    agenda = agendaSnapshotSchema.parse(await response.json());
  }
  const published = await staff.request.post(`${base}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: agenda.revision }),
  });
  expect(published.status()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await published.json());
  expect(agenda.publishedRevision).toBe(agenda.revision);
  if (!agenda.publicAgendaPath) throw new Error("Approved public agenda path missing");
  const release = await publishE2eSite(staff, agenda.publicAgendaPath);
  return { slug, eventId, base, agenda, room, release, closedAt };
}

/**
 * Real mailbox confirmation, with day/terms taken from this event's canonical placement. An event
 * created after the static release has no confirmation page yet, so `staticRelease: false` redeems
 * the same mailbox capability at the endpoint that page uses.
 */
export async function registerStateAttendee(
  page: Page,
  fixture: Awaited<ReturnType<typeof createRegistrationEvent>>,
  email: string,
  { staticRelease = true, organization }: { staticRelease?: boolean; organization?: string } = {},
) {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(email) });
  const placementResponse = await page.request.get(
    `/api/v1/events/${fixture.slug}/forms/placements/event_registration`,
  );
  expect(placementResponse.status()).toBe(200);
  const placement = eventFormsResponseSchema.parse(await placementResponse.json());
  expect(placement.event.id).toBe(fixture.eventId);
  expect(placement.eventDays).toHaveLength(1);
  const answers: z.infer<typeof registrationCreateSchema>["customAnswers"] = {};
  const knownAnswers: Record<string, string> = {
    country: "US",
  };
  for (const field of placement.form?.fields ?? []) {
    if (field.key in knownAnswers) answers[field.key] = knownAnswers[field.key]!;
    else if (field.required) throw new Error(`Unsupported required fixture field: ${field.key}`);
  }
  const since = await capturedEmailCount();
  const submitted = await page.request.post(`/api/v1/events/${fixture.slug}/registrations`, {
    data: registrationCreateSchema.parse({
      email,
      firstName: "Synthetic",
      lastName: "Attendee",
      attendanceType: "in_person",
      dayAttendance: placement.eventDays.map((day) => ({ dayDate: day.dayDate, attendanceType: "in_person" })),
      customAnswers: answers,
      consents: placement.requiredTerms.map(({ termKey, version }) => ({ termKey, version })),
    }),
  });
  expect(submitted.status()).toBe(200);
  const submission = registrationSubmissionResponseSchema.parse(await submitted.json());
  // A registrant already signed in with this verified address is confirmed at once: the mailbox is proven.
  if (submission.status !== "pending_email_confirmation") {
    // Its confirmation mail is queued behind the badge delay; nothing here waits on it.
    expect(submission.status).toBe("registered");
    return;
  }
  const confirmation = await waitForCapturedEmail(email, "Confirm your registration", { since });
  const confirmationUrl = extractEmailUrl(confirmation, "/register/confirm");
  if (staticRelease) {
    await page.goto(confirmationUrl);
    await confirmRegistration(page, organization);
  } else {
    const query = new URL(confirmationUrl).searchParams;
    const capability = registrationConfirmQuerySchema.parse({ id: query.get("id"), token: query.get("token") });
    const confirmed = await page.request.post(`/api/v1/events/${fixture.slug}/registrations/confirm-email`, {
      data: registrationConfirmSchema.parse(capability),
    });
    expect(confirmed.status(), await confirmed.text()).toBe(200);
    expect(registrationConfirmResponseSchema.parse(await confirmed.json())).toMatchObject({ stage: "confirmed" });
  }
  await waitForCapturedEmail(email, "registration is confirmed", { since });
}
