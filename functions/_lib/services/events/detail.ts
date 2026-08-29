import {
  eventDetailSchema,
  type EventDetail,
  type EventManagementCapability,
} from "../../../../assets/shared/schemas/event-management";
import { parseLinksJson } from "../../../../assets/shared/schemas/links";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { resolveEventSessionTypes } from "../events";
import { eventColumns, type EventRecord } from "../event-types";

interface EventDetailRow extends EventRecord {
  user_retention_days: number | null;
  series_id: string | null;
}

export function normalizeEventRegistrationPolicy(value: string): EventDetail["registrationPolicy"] {
  switch (value) {
    case "open":
    case "invite_or_open":
      return "public";
    case "invite_only":
      return "invitation_only";
    case "no_registration":
    case "optional":
    case "invitation_only":
    case "required":
    case "public":
      return value;
    default:
      return "optional";
  }
}

export async function getEventIdBySlug(db: DatabaseLike, eventSlug: string): Promise<string | null> {
  return (await first<{ id: string }>(db, "SELECT id FROM events WHERE slug = ?", [eventSlug]))?.id ?? null;
}

/** Canonical camelCase read model shared by event resource routes and callers. */
export async function getEventDetail(
  db: DatabaseLike,
  eventSlug: string,
  capabilities: readonly EventManagementCapability[],
): Promise<EventDetail> {
  const event = await first<EventDetailRow>(
    db,
    `SELECT ${eventColumns("event")}, policy.user_retention_days, series.id AS series_id
       FROM events event
       LEFT JOIN retention_policies policy ON policy.event_id = event.id
       LEFT JOIN event_series series ON series.event_id = event.id
      WHERE event.slug = ?`,
    [eventSlug],
  );
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  const directWriteAllowed =
    !event.owner_group_id &&
    event.source_mode !== "portal" &&
    event.profile_key !== "meeting" &&
    event.profile_key !== "board_meeting" &&
    !event.series_id;
  return eventDetailSchema.parse({
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    profileKey: event.profile_key ?? null,
    sourceMode: event.source_mode ?? null,
    registrationPolicy: normalizeEventRegistrationPolicy(event.registration_mode),
    visibility: event.visibility,
    inviteLimitAttendee: event.invite_limit_attendee,
    updatedAt: event.updated_at,
    ownerGroupId: event.owner_group_id ?? null,
    seriesId: event.series_id,
    basePath: event.base_path,
    userRetentionDays: event.user_retention_days,
    venue: typeof settings.venue === "string" ? settings.venue : null,
    virtualUrl: typeof settings.virtualUrl === "string" ? settings.virtualUrl : null,
    heroImageUrl: typeof settings.heroImageUrl === "string" ? settings.heroImageUrl : null,
    location: typeof settings.location === "string" ? settings.location : null,
    sessionTypes: resolveEventSessionTypes(event.settings_json),
    links: parseLinksJson(event.links_json),
    settings,
    capabilities: directWriteAllowed ? capabilities : capabilities.filter((capability) => capability !== "write"),
  });
}
