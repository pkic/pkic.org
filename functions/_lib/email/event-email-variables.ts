import { deriveEventBasePath } from "../../../assets/shared/event-flow-paths";
import { eventVirtualRoomUrl } from "../../../assets/shared/event-participation-link";
import { first } from "../db/queries";
import { getStaticAssetsBinding } from "../static-assets";
import type { DatabaseLike, Env } from "../types";
import { parseJsonSafe } from "../utils/json";

/** The event columns an email reads; an event record satisfies it. */
export interface EventEmailSource {
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
  timezone?: string;
  ends_at?: string | null;
}

export interface EventEmailVariables {
  eventName: string;
  eventSlug: string;
  eventTimezone: string;
  eventStartsAt: string;
  eventEndsAt: string;
  eventUrl: string;
  sponsorsImageUrl: string | null;
  virtualRoomUrl: string;
}

type SponsorImageSource = Pick<EventEmailSource, "slug" | "base_path" | "starts_at" | "settings_json">;

/**
 * The site build renders an event's sponsor wall to this image, and only when the event has
 * sponsors. An explicit `sponsorsImageUrl` setting replaces it (null hides it), so then there is none.
 */
function generatedSponsorsImagePath(event: SponsorImageSource): string | null {
  const settings = parseJsonSafe<{ sponsorsImageUrl?: string | null }>(event.settings_json, {});
  return "sponsorsImageUrl" in settings ? null : `${deriveEventBasePath(event)}sponsors.jpg`;
}

function resolveSponsorsImageUrl(event: SponsorImageSource, siteBaseUrl: string): string | null {
  const settings = parseJsonSafe<{ sponsorsImageUrl?: string | null }>(event.settings_json, {});
  if ("sponsorsImageUrl" in settings) return settings.sponsorsImageUrl?.trim() || null;
  return `${siteBaseUrl}${generatedSponsorsImagePath(event)}`;
}

export function buildEventEmailVariables(event: EventEmailSource, siteBaseUrl: string): EventEmailVariables {
  return {
    eventName: event.name,
    eventSlug: event.slug,
    eventTimezone: event.timezone ?? "",
    eventStartsAt: event.starts_at ?? "",
    eventEndsAt: event.ends_at ?? "",
    eventUrl: `${siteBaseUrl}${deriveEventBasePath(event)}`,
    virtualRoomUrl: eventVirtualRoomUrl(event.slug, siteBaseUrl),
    sponsorsImageUrl: resolveSponsorsImageUrl(event, siteBaseUrl),
  };
}

const EVENT_EMAIL_SOURCE_QUERY =
  "SELECT name, slug, base_path, starts_at, ends_at, timezone, settings_json FROM events WHERE id = ?";

/**
 * An email tied to an event takes the event's name, links and sponsor image from the event
 * itself, so no sender has to pass them. The generated sponsor image is linked only when the
 * site build published one: an event without sponsors has no image, and its emails show none.
 */
export async function loadEventEmailVariables(
  db: DatabaseLike,
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">,
  eventId: string,
  siteBaseUrl: string,
): Promise<EventEmailVariables | null> {
  const event = await first<EventEmailSource>(db, EVENT_EMAIL_SOURCE_QUERY, [eventId]);
  if (!event) return null;
  const variables = buildEventEmailVariables(event, siteBaseUrl);
  const generated = generatedSponsorsImagePath(event);
  if (generated && !(await publishedAssetExists(env, siteBaseUrl, generated))) variables.sponsorsImageUrl = null;
  return variables;
}

/** Without a static-assets binding (some tests) the image cannot be checked and stays linked. */
async function publishedAssetExists(
  env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">,
  siteBaseUrl: string,
  path: string,
): Promise<boolean> {
  const assets = getStaticAssetsBinding(env);
  if (!assets) return true;
  const response = await assets.fetch(new Request(new URL(path, siteBaseUrl), { method: "HEAD" }));
  return response.ok;
}
