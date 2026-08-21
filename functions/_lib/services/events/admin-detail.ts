import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { getEventBySlug, resolveEventSessionTypes } from "../events";

export async function getAdminEventDetail(db: DatabaseLike, eventSlug: string) {
  const event = await getEventBySlug(db, eventSlug);
  const retention = await first<{ user_retention_days: number }>(
    db,
    "SELECT user_retention_days FROM retention_policies WHERE event_id = ?",
    [event.id],
  );
  const settings = parseJsonSafe<Record<string, unknown>>(event.settings_json, {});
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    base_path: event.base_path,
    registration_mode: event.registration_mode,
    invite_limit_attendee: event.invite_limit_attendee,
    user_retention_days: retention?.user_retention_days ?? null,
    venue: (settings.venue as string | null) ?? null,
    virtual_url: (settings.virtualUrl as string | null) ?? null,
    hero_image_url: (settings.heroImageUrl as string | null) ?? null,
    location: (settings.location as string | null) ?? null,
    session_types: resolveEventSessionTypes(event.settings_json),
    settings,
  };
}
