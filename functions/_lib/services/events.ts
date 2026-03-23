import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { nowIso } from "../utils/time";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import { uuid } from "../utils/ids";
import type { DatabaseLike } from "../types";

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  /** @deprecated Use base_path instead. Kept in DB but no longer read by application code. */
  source_path: string | null;
  /** Canonical frontend URL prefix for the event, e.g. "/events/2026/my-event/".
   *  Set by the frontend via X-Event-Base-Path on first submission so the value
   *  matches the actual Hugo page location, whatever that may be. */
  base_path: string | null;
  capacity_in_person: number | null;
  registration_mode: string;
  invite_limit_attendee: number;
  invite_limit_speaker_nomination: number;
  settings_json: string;
}

export interface EventTermRecord {
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}

interface EventSettingsRoutes {
  registration?: string;
  registrationConfirm?: string;
  proposal?: string;
  registrationManage?: string;
  proposalManage?: string;
  speakerManage?: string;
  inviteDecline?: string;
}

interface EventSettings {
  frontend?: {
    routes?: EventSettingsRoutes;
  };
  /** Physical venue address shown to in-person attendees in the calendar invite. */
  venue?: string | null;
  /**
   * Override URL for virtual/live attendees in the calendar invite.
   * Defaults to {eventBasePath}virtual/ when not set.
   */
  virtualUrl?: string | null;
  /** Proposal form configuration. */
  proposal?: {
    /**
     * The session types offered for this event's call for speakers.
     * Each value must be a valid proposalType (e.g. "talk", "panel", "keynote").
     * Falls back to ["talk", "keynote", "panel"] when not configured.
     */
    sessionTypes?: string[];
  };
}

export interface EventFrontendRoutes {
  registrationPath: string;
  registrationConfirmPath: string;
  proposalPath: string;
  registrationManagePath: string;
  proposalManagePath: string;
  speakerManagePath: string;
  inviteDeclinePath: string;
  usedFallback: boolean;
  fallbackKeys: string[];
}

type EventEmailSource =
  Pick<EventRecord, "name" | "slug" | "base_path" | "starts_at" | "settings_json">
  & Partial<Pick<EventRecord, "timezone" | "ends_at">>;

export interface EventEmailVariables {
  eventName: string;
  eventSlug: string;
  eventTimezone: string;
  eventStartsAt: string;
  eventEndsAt: string;
  eventUrl: string;
}

/**
 * Returns the canonical frontend base path for an event.
 *
 * Priority:
 *  1. base_path stored in DB — set by Hugo via X-Event-Base-Path header on
 *     first submission; reflects the actual page URL regardless of site layout.
 *  2. Year extracted from starts_at + slug — fallback for events seeded before
 *     base_path was introduced, or when no request has been made yet.
 *  3. Slug only — last-resort fallback (no year prefix).
 */
function getEventBasePath(event: Pick<EventRecord, "slug" | "base_path" | "starts_at">): string {
  if (event.base_path) {
    return event.base_path;
  }
  if (event.starts_at) {
    const year = event.starts_at.substring(0, 4);
    if (/^\d{4}$/.test(year)) {
      return `/events/${year}/${event.slug}/`;
    }
  }
  return `/events/${event.slug}/`;
}

function defaultFrontendPaths(event: Pick<EventRecord, "slug" | "base_path" | "starts_at">): Omit<EventFrontendRoutes, "usedFallback" | "fallbackKeys"> {
  const base = getEventBasePath(event);
  return {
    registrationPath: `${base}register/`,
    registrationConfirmPath: `${base}register/confirm/`,
    proposalPath: `${base}propose/`,
    registrationManagePath: `${base}register/manage/`,
    proposalManagePath: `${base}propose-manage/`,
    speakerManagePath: `${base}propose/speaker/`,
    inviteDeclinePath: `${base}invite/decline/`,
  };
}

/**
 * Normalizes a route path value:
 * - Absolute paths (starting with "/") are used as-is.
 * - Relative paths are resolved against the event's base path (e.g. "register/" → "/events/2026/my-event/register/").
 * - Trailing slash is always added.
 * - Empty / missing values return null (signals fallback to default).
 */
function normalizeFrontendPath(value: string | undefined, basePath?: string): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  let resolved: string;
  if (trimmed.startsWith("/")) {
    resolved = trimmed;
  } else if (basePath) {
    const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
    resolved = `${base}${trimmed}`;
  } else {
    resolved = `/${trimmed}`;
  }

  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

export function resolveEventFrontendRoutes(event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">): EventFrontendRoutes {
  const basePath = getEventBasePath(event);
  const defaults = defaultFrontendPaths(event);
  const settings = parseJsonSafe<EventSettings>(event.settings_json, {});
  const routes = settings.frontend?.routes ?? {};

  const resolved = {
    registrationPath: normalizeFrontendPath(routes.registration, basePath) ?? defaults.registrationPath,
    registrationConfirmPath: normalizeFrontendPath(routes.registrationConfirm, basePath) ?? defaults.registrationConfirmPath,
    proposalPath: normalizeFrontendPath(routes.proposal, basePath) ?? defaults.proposalPath,
    registrationManagePath: normalizeFrontendPath(routes.registrationManage, basePath) ?? defaults.registrationManagePath,
    proposalManagePath: normalizeFrontendPath(routes.proposalManage, basePath) ?? defaults.proposalManagePath,
    speakerManagePath: normalizeFrontendPath(routes.speakerManage, basePath) ?? defaults.speakerManagePath,
    inviteDeclinePath: normalizeFrontendPath(routes.inviteDecline, basePath) ?? defaults.inviteDeclinePath,
  };

  const fallbackKeys: string[] = [];
  if (!normalizeFrontendPath(routes.registration, basePath)) fallbackKeys.push("registration");
  if (!normalizeFrontendPath(routes.registrationConfirm, basePath)) fallbackKeys.push("registrationConfirm");
  if (!normalizeFrontendPath(routes.proposal, basePath)) fallbackKeys.push("proposal");
  if (!normalizeFrontendPath(routes.registrationManage, basePath)) fallbackKeys.push("registrationManage");
  if (!normalizeFrontendPath(routes.proposalManage, basePath)) fallbackKeys.push("proposalManage");
  if (!normalizeFrontendPath(routes.speakerManage, basePath)) fallbackKeys.push("speakerManage");
  if (!normalizeFrontendPath(routes.inviteDecline, basePath)) fallbackKeys.push("inviteDecline");

  return {
    ...resolved,
    usedFallback: fallbackKeys.length > 0,
    fallbackKeys,
  };
}

/**
 * Resolves the sponsors banner image URL for an event.
 *
 * Priority:
 *  1. Explicit value in settings_json.sponsorsImageUrl — allows override or
 *     opt-out (set to null / empty string to disable for a specific event).
 *  2. Auto-derived from base_path + slug, e.g.
 *     "/events/2026/slug/" → "https://pkic.org/events/2026/slug/sponsors.jpg"
 *
 * Returns null when no URL can be resolved. Template guards like
 * {{#if sponsorsImageUrl}} will suppress the sponsors section automatically.
 */
export function resolveSponsorsImageUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">,
  siteBaseUrl: string,
): string | null {
  const settings = parseJsonSafe<{ sponsorsImageUrl?: string | null }>(event.settings_json, {});

  // Explicit setting wins — null/empty means "disabled", string means "use this URL".
  if ("sponsorsImageUrl" in settings) {
    const explicit = settings.sponsorsImageUrl;
    return explicit && explicit.trim() ? explicit.trim() : null;
  }

  // Auto-derive from base_path (set by Hugo via X-Event-Base-Path)
  // e.g. base_path = "/events/2026/pqc-conference-amsterdam-nl/"
  //   →  "https://pkic.org/events/2026/pqc-conference-amsterdam-nl/sponsors.jpg"
  const base = getEventBasePath(event);
  return `${siteBaseUrl}${base}sponsors.jpg`;
}

/**
 * Returns the URL of the event hero image for use in the email header area.
 *
 * Unlike sponsors, the hero image filename varies per event (e.g. "amsterdam-nl.png"),
 * so it cannot be auto-derived from source_path. It must be explicitly configured
 * in settings_json.heroImageUrl — typically a full absolute URL to the image
 * served from the Hugo content bundle (e.g. "https://pkic.org/events/2026/slug/amsterdam-nl.png").
 *
 * Set settings_json.heroImageUrl to:
 *   - A full URL string → hero image is shown below the brand stripe in emails
 *   - null or ""        → no hero image (default)
 */
export function resolveHeroImageUrl(
  event: Pick<EventRecord, "settings_json">,
): string | null {
  const settings = parseJsonSafe<{ heroImageUrl?: string | null }>(event.settings_json, {});
  if ("heroImageUrl" in settings) {
    const explicit = settings.heroImageUrl;
    return explicit && explicit.trim() ? explicit.trim() : null;
  }
  return null;
}

/**
 * Returns the physical venue address for in-person attendees, or null if not configured.
 * Reads from settings_json.venue.
 */
export function resolveEventVenue(
  event: Pick<EventRecord, "settings_json">,
): string | null {
  const settings = parseJsonSafe<EventSettings>(event.settings_json, {});
  return settings.venue?.trim() || null;
}

/**
 * Returns the URL for virtual/live attendees to join the event online.
 *
 * Priority:
 *  1. Explicit settings_json.virtualUrl
 *  2. Auto-derived: {siteBaseUrl}/events/YYYY/slug/virtual/
 */
export function resolveEventVirtualUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">,
  siteBaseUrl: string,
): string | null {
  const settings = parseJsonSafe<EventSettings>(event.settings_json, {});
  if (settings.virtualUrl?.trim()) {
    return settings.virtualUrl.trim();
  }
  const base = getEventBasePath(event);
  return `${siteBaseUrl}${base}virtual/`;
}

/**
 * Resolves the canonical frontend URL for an event.
 *
 * Always returns a URL by deriving from base_path/starts_at/slug in the same
 * way as frontend route generation.
 */
export function resolveEventUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at">,
  siteBaseUrl: string,
): string {
  return `${siteBaseUrl}${getEventBasePath(event)}`;
}

/**
 * Returns a comprehensive baseline variable set for event-related emails.
 *
 * Templates can rely on these keys being present across all event email flows,
 * even when a specific template does not currently use each field.
 */
export function buildEventEmailVariables(
  event: EventEmailSource,
  siteBaseUrl: string,
): EventEmailVariables {
  return {
    eventName: event.name,
    eventSlug: event.slug,
    eventTimezone: event.timezone ?? "",
    eventStartsAt: event.starts_at ?? "",
    eventEndsAt: event.ends_at ?? "",
    eventUrl: resolveEventUrl(event, siteBaseUrl),
  };
}

export async function getEventBySlug(db: DatabaseLike, slug: string): Promise<EventRecord> {
  const event = await first<EventRecord>(db, "SELECT * FROM events WHERE slug = ?", [slug]);
  if (!event) {
    throw new AppError(404, "EVENT_NOT_FOUND", `Event '${slug}' not found`);
  }
  return event;
}

export async function getRequiredTerms(
  db: DatabaseLike,
  eventId: string,
  audienceType: "attendee" | "speaker",
): Promise<EventTermRecord[]> {
  return all<EventTermRecord>(
    db,
    `SELECT term_key, version, required, content_ref
            , display_text, help_text
     FROM event_terms
     WHERE event_id = ? AND audience_type = ? AND active = 1
     ORDER BY term_key ASC`,
    [eventId, audienceType],
  );
}

export async function upsertEventFromHugo(
  db: DatabaseLike,
  payload: {
    slug: string;
    name: string;
    timezone: string;
    startsAt?: string | null;
    endsAt?: string | null;
    registrationMode?: string;
    inviteLimitAttendee?: number;
    inviteLimitSpeakerNomination?: number;
    settings?: Record<string, unknown>;
  },
): Promise<EventRecord> {
  const existing = await first<EventRecord>(db, "SELECT * FROM events WHERE slug = ?", [payload.slug]);
  const now = nowIso();

  if (!existing) {
    const event: EventRecord = {
      id: uuid(),
      slug: payload.slug,
      name: payload.name,
      timezone: payload.timezone,
      starts_at: payload.startsAt ?? null,
      ends_at: payload.endsAt ?? null,
      source_path: null,
      base_path: null, // Set on first frontend submission via updateEventBasePath
      capacity_in_person: null,
      registration_mode: payload.registrationMode ?? "invite_or_open",
      invite_limit_attendee: payload.inviteLimitAttendee ?? 50,
      invite_limit_speaker_nomination: payload.inviteLimitSpeakerNomination ?? 10,
      settings_json: stringifyJson(payload.settings ?? {}),
    };

    await run(
      db,
      `INSERT INTO events (
        id, slug, name, timezone, starts_at, ends_at, source_path, base_path, capacity_in_person,
        registration_mode, invite_limit_attendee, invite_limit_speaker_nomination, settings_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id,
        event.slug,
        event.name,
        event.timezone,
        event.starts_at,
        event.ends_at,
        event.source_path,
        event.base_path,
        event.capacity_in_person,
        event.registration_mode,
        event.invite_limit_attendee,
        event.invite_limit_speaker_nomination,
        event.settings_json,
        now,
        now,
      ],
    );

    return event;
  }

  await run(
    db,
    `UPDATE events
     SET name = ?, timezone = ?, starts_at = ?, ends_at = ?,
         capacity_in_person = ?, registration_mode = ?, invite_limit_attendee = ?,
         invite_limit_speaker_nomination = ?, settings_json = ?, updated_at = ?
     WHERE id = ?`,
    [
      payload.name,
      payload.timezone,
      payload.startsAt ?? existing.starts_at,
      payload.endsAt ?? existing.ends_at,
      null,
      payload.registrationMode ?? existing.registration_mode,
      payload.inviteLimitAttendee ?? existing.invite_limit_attendee,
      payload.inviteLimitSpeakerNomination ?? existing.invite_limit_speaker_nomination,
      stringifyJson({
        ...parseJsonSafe<Record<string, unknown>>(existing.settings_json, {}),
        ...(payload.settings ?? {}),
      }),
      now,
      existing.id,
    ],
  );

  return getEventBySlug(db, payload.slug);
}

/** Allowed characters in a base path: letters, digits, hyphens, underscores, dots, slashes. */
const BASE_PATH_RE = /^\/[a-zA-Z0-9/_\-.]+\/$/;

/**
 * Records the canonical frontend base path for an event, sent by Hugo via
 * the X-Event-Base-Path request header on the first registration or proposal
 * submission.
 *
 * Only updates if the provided path is valid (relative, same-origin) and the
 * event does not already have a base_path recorded, so it cannot be overwritten
 * by a manipulated browser request after the fact.
 */
export async function updateEventBasePath(
  db: DatabaseLike,
  eventId: string,
  rawPath: string | null | undefined,
): Promise<void> {
  if (!rawPath) return;
  const path = rawPath.trim();
  if (!BASE_PATH_RE.test(path)) return; // reject malformed or external paths
  await run(
    db,
    "UPDATE events SET base_path = ? WHERE id = ? AND base_path IS NULL",
    [path, eventId],
  );
}

export async function replaceEventTerms(
  db: DatabaseLike,
  eventId: string,
  audienceType: "attendee" | "speaker",
  terms: Array<{ termKey: string; version: string; required?: boolean; contentRef?: string; displayText?: string }>,
): Promise<void> {
  await run(
    db,
    "UPDATE event_terms SET active = 0 WHERE event_id = ? AND audience_type = ?",
    [eventId, audienceType],
  );

  const now = nowIso();
  for (const term of terms) {
    await run(
      db,
      `INSERT INTO event_terms (
        id, event_id, audience_type, term_key, version, required, content_ref, display_text, active, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(event_id, audience_type, term_key, version)
      DO UPDATE SET required = excluded.required, content_ref = excluded.content_ref, display_text = excluded.display_text, active = 1`,
      [
        uuid(),
        eventId,
        audienceType,
        term.termKey,
        term.version,
        term.required === false ? 0 : 1,
        term.contentRef ?? null,
        term.displayText ?? null,
        now,
      ],
    );
  }
}
