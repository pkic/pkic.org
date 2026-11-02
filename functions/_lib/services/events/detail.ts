import {
  eventDetailSchema,
  type EventDetail,
  type EventManagementCapability,
} from "../../../../assets/shared/schemas/event-management";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { resolveEventSessionTypes } from "../events";
import { eventColumns, type EventRecord } from "../event-types";
import { EVENT_FORM_PURPOSES } from "../../../../assets/shared/schemas/forms";
import { placedEventFormSelection } from "../forms/event-placement-read";
import { readEventAudienceAccess } from "./scanner-access";
import type { EventAudienceViewer } from "./visibility";
import { persistedUtcInstant } from "../../utils/time";

export interface EventDetailRow extends EventRecord {
  user_retention_days: number | null;
  series_id: string | null;
  form_links_json: string;
}

export function normalizeEventRegistrationPolicy(value: string): EventDetail["registrationPolicy"] {
  switch (value) {
    case "open":
    case "invite_or_open":
      return "public";
    case "invite_only":
      return "invitation_only";
    case "no_registration":
    case "automatic":
    case "optional":
    case "invitation_only":
    case "required":
    case "public":
      return value;
    default:
      return "optional";
  }
}

/** Canonical camelCase read model shared by event resource routes and callers. */
export async function getEventDetail(
  db: DatabaseLike,
  eventSlug: string,
  capabilities: readonly EventManagementCapability[],
  viewer?: EventAudienceViewer,
): Promise<EventDetail> {
  const read = prepareEventDetail(db, eventSlug);
  const event = await read.first<EventDetailRow>();
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const access = viewer
    ? (await readEventAudienceAccess(db, viewer, [event.id])).get(event.id)?.scannerAccess
    : undefined;
  return decodeEventDetail(event, capabilities, access);
}

export function prepareEventDetail(db: DatabaseLike, eventSlug: string, authority?: AuthorizationEvidence) {
  const formReads = EVENT_FORM_PURPOSES.map((purpose) =>
    placedEventFormSelection({ slug: eventSlug }, purpose, {
      includeClosed: true,
    }),
  );
  return db
    .prepare(`SELECT ${eventColumns("event")}, policy.user_retention_days, series.id AS series_id,
      json_object('event_registration', (SELECT CASE WHEN COUNT(*)=1 THEN MIN(key) END FROM (${formReads[0].sql})),
                  'proposal_submission', (SELECT CASE WHEN COUNT(*)=1 THEN MIN(key) END FROM (${formReads[1].sql}))) AS form_links_json
       FROM events event
       LEFT JOIN retention_policies policy ON policy.event_id = event.id
       LEFT JOIN event_series series ON series.event_id = event.id
      WHERE event.slug = ? ${authority ? `AND EXISTS(${authority.sql})` : ""}`)
    .bind(...formReads.flatMap((read) => read.bindings), eventSlug, ...(authority?.bindings ?? []));
}

export function decodeEventDetail(
  event: EventDetailRow,
  capabilities: readonly EventManagementCapability[],
  scannerAccess?: EventDetail["scannerAccess"],
): EventDetail {
  const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  settings.forms = parseJsonSafe<Record<string, string | null>>(event.form_links_json, {});
  const directWriteAllowed =
    !event.owner_group_id &&
    event.source_mode !== "portal" &&
    event.profile_key !== "meeting" &&
    event.profile_key !== "board_meeting" &&
    !event.series_id;
  return eventDetailSchema.parse({
    scannerAccess,
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    startsAt: persistedUtcInstant(event.starts_at),
    endsAt: persistedUtcInstant(event.ends_at),
    profileKey: event.profile_key ?? null,
    sourceMode: event.source_mode ?? null,
    registrationPolicy: normalizeEventRegistrationPolicy(event.registration_mode),
    visibility: event.visibility,
    inviteLimitAttendee: event.invite_limit_attendee,
    city: event.city,
    country: event.country,
    updatedAt: persistedUtcInstant(event.updated_at),
    ownerGroupId: event.owner_group_id ?? null,
    seriesId: event.series_id,
    basePath: event.base_path,
    userRetentionDays: event.user_retention_days,
    venue: typeof settings.venue === "string" ? settings.venue : null,
    virtualUrl: typeof settings.virtualUrl === "string" ? settings.virtualUrl : null,
    heroImageUrl: typeof settings.heroImageUrl === "string" ? settings.heroImageUrl : null,
    sessionTypes: resolveEventSessionTypes(event.settings_json),
    links: parseLinksJson(event.links_json),
    settings,
    capabilities: directWriteAllowed ? capabilities : capabilities.filter((capability) => capability !== "write"),
  });
}
