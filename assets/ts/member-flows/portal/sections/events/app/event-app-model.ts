/**
 * What the event app needs to know about the reader's standing, derived once
 * from the caller-scoped event projection the portal already loads
 * (`GET /api/v1/events/:slug`) rather than from extra requests.
 */
import type { z } from "zod";
import type { eventDetailResponseSchema } from "../../../../../../shared/schemas/event-management";
import { formatEventPlace } from "../../../../../../shared/event-place";

export type ParticipantEventDetail = z.infer<typeof eventDetailResponseSchema>["event"];

export interface EventRegistrationStanding {
  registrationId: string | null;
  status: "pending_email_confirmation" | "registered" | "cancelled" | null;
  /** Holds a live (not cancelled) registration. */
  registered: boolean;
}

/** Reads the projection's own fields only, so the scanner's reduced event projection qualifies too. */
export function eventRegistrationStanding(event: {
  participation?: ParticipantEventDetail["participation"];
  viewer?: { registrationStatus: EventRegistrationStanding["status"] } | null;
}): EventRegistrationStanding {
  const viewer = "viewer" in event ? (event.viewer ?? null) : null;
  const registrationId = event.participation?.registrationId ?? null;
  const status = event.participation?.registrationStatus ?? viewer?.registrationStatus ?? null;
  return {
    registrationId,
    status,
    registered: Boolean((registrationId || viewer) && status && status !== "cancelled"),
  };
}

/**
 * Whether the reader can open the registration form, or the policy that
 * explains why it is unavailable. The portal retains the signed-in session.
 */
export type RegistrationOffer = { kind: "open" } | { kind: "closed"; reason: string };

const OPEN_POLICIES = new Set(["optional", "required", "public"]);

export function registrationOffer(event: ParticipantEventDetail, ended: boolean): RegistrationOffer {
  if (ended) return { kind: "closed", reason: "This event has ended." };
  if ("registrationPath" in event && event.registrationPath) return { kind: "open" };
  switch (event.registrationPolicy) {
    case "invitation_only":
      return { kind: "closed", reason: "Registration for this event is by invitation only." };
    case "no_registration":
      return { kind: "closed", reason: "This event does not need registration." };
    case "automatic":
      return { kind: "closed", reason: "Members of the organizing group are registered automatically." };
  }
  // The management projection has no public registration path; its policy still permits the in-app form.
  if (!("viewer" in event) && OPEN_POLICIES.has(event.registrationPolicy) && event.basePath) return { kind: "open" };
  return { kind: "closed", reason: "Registration is not open for this event." };
}

/**
 * Where an organizer manages this event, when the reader may: the group
 * workspace that owns it. The management projection is served only to a
 * reader the backend grants event capabilities, so its presence is the
 * permission; the audience projection never carries one.
 */
export function eventManagementPath(event: ParticipantEventDetail): string | null {
  if (!("capabilities" in event) || event.capabilities.length === 0 || !event.ownerGroupId) return null;
  return `/groups/${encodeURIComponent(event.ownerGroupId)}/events/${encodeURIComponent(event.id)}`;
}

/** The full venue address and the city and country for the venue details, without repeating a line. */
export function eventVenueLines(event: ParticipantEventDetail): string[] {
  const venue = "venue" in event ? event.venue : null;
  const lines = [venue, formatEventPlace(event)].filter((line): line is string => Boolean(line?.trim()));
  // "Amsterdam, Netherlands" adds nothing after an address that already names Amsterdam and the Netherlands.
  const parts = (line: string) =>
    line.split(",").map((part) =>
      part
        .trim()
        .toLocaleLowerCase("en-US")
        .replace(/^the\s+/u, ""),
    );
  return lines.filter((line, index) => {
    const earlier = new Set(lines.slice(0, index).flatMap(parts));
    return !parts(line).every((part) => earlier.has(part));
  });
}
