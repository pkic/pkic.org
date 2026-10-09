/**
 * What the event app needs to know about the reader's standing, derived once
 * from the caller-scoped event projection the portal already loads
 * (`GET /api/v1/events/:slug`) rather than from extra requests.
 */
import type { z } from "zod";
import type { eventDetailResponseSchema } from "../../../../../../shared/schemas/event-management";

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
 * How the reader may register when they have not: a link into the existing
 * registration flow when the audience projection offers one, otherwise the
 * policy that explains why not.
 */
export type RegistrationOffer =
  { kind: "open"; href: string } | { kind: "public-page"; href: string } | { kind: "closed"; reason: string };

const OPEN_POLICIES = new Set(["optional", "required", "public"]);

export function registrationOffer(event: ParticipantEventDetail, ended: boolean): RegistrationOffer {
  if (ended) return { kind: "closed", reason: "This event has ended." };
  if ("registrationPath" in event && event.registrationPath) return { kind: "open", href: event.registrationPath };
  switch (event.registrationPolicy) {
    case "invitation_only":
      return { kind: "closed", reason: "Registration for this event is by invitation only." };
    case "no_registration":
      return { kind: "closed", reason: "This event does not need registration." };
    case "automatic":
      return { kind: "closed", reason: "Members of the organizing group are registered automatically." };
  }
  // The management projection carries no registration path; its public page links the flow.
  if (!("viewer" in event) && OPEN_POLICIES.has(event.registrationPolicy) && event.basePath)
    return { kind: "public-page", href: event.basePath };
  return { kind: "closed", reason: "Registration is not open for this event." };
}

/** "in_person" as "In person": the attendance type words the badge and ticket print. */
export function attendanceLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** The first part of an address line: a venue's name, or a location's city. */
function leadingPart(value: string | null | undefined): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/**
 * Where the event is, once: the venue's name and the city ("Meervaart ·
 * Amsterdam"), not the venue's postal address followed by the location again.
 * The full address belongs on the event's venue details (More).
 */
export function eventPlaceSummary(event: ParticipantEventDetail): string | null {
  const venue = "venue" in event ? event.venue : null;
  const parts: string[] = [];
  for (const part of [leadingPart(venue), leadingPart(event.location)])
    if (part && !parts.some((seen) => seen.toLocaleLowerCase() === part.toLocaleLowerCase())) parts.push(part);
  return parts.length ? parts.join(" · ") : null;
}

/** The full venue address and location lines for the venue details, without repeating a line. */
export function eventVenueLines(event: ParticipantEventDetail): string[] {
  const venue = "venue" in event ? event.venue : null;
  const lines = [venue, event.location].filter((line): line is string => Boolean(line?.trim()));
  // "Amsterdam, The Netherlands" adds nothing after an address that already names Amsterdam and the Netherlands.
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
