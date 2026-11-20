import contentMediaPaths from "virtual:pkic-content-media";
import { resolveContentMediaUrl } from "../../../assets/shared/content-media-url";
import type { z } from "zod";
import { parseJsonSafe } from "../utils/json";
import { buildEventFlowPath, deriveEventBasePath } from "../../../assets/shared/event-flow-paths";
import { proposalSessionTypeSchema } from "../../../assets/shared/schemas/proposal-management";
import { AppError } from "../errors";
import type { EventRecord } from "./event-types";

interface EventSettingsRoutes {
  registration?: string;
  registrationConfirm?: string;
  proposal?: string;
  registrationManage?: string;
  proposalManage?: string;
  speakerManage?: string;
  speakerPresentation?: string;
  inviteDecline?: string;
}

interface EventSettings {
  frontend?: { routes?: EventSettingsRoutes };
  venue?: string | null;
  virtualUrl?: string | null;
  proposal?: { sessionTypes?: SessionTypeConfig[] };
}

export type SessionTypeConfig = z.infer<typeof proposalSessionTypeSchema>;

const DEFAULT_SESSION_TYPES: readonly SessionTypeConfig[] = [
  { label: "talk", requiresPresentation: true },
  { label: "keynote", requiresPresentation: true },
  { label: "panel", requiresPresentation: true },
];

/** Normalizes both current session-type objects and legacy string entries. */
export function resolveSessionTypes(
  settings: { proposal?: { sessionTypes?: unknown[] } | null } | null,
): SessionTypeConfig[] {
  // Legacy settings may hold JSON null for the whole object or for its proposal container.
  const raw = settings?.proposal?.sessionTypes;
  if (!Array.isArray(raw) || raw.length === 0) return [...DEFAULT_SESSION_TYPES];

  const sessionTypes: SessionTypeConfig[] = [];
  const labels = new Set<string>();
  for (const entry of raw) {
    const parsed = proposalSessionTypeSchema.safeParse(
      typeof entry === "string" ? { label: entry, requiresPresentation: true } : entry,
    );
    if (!parsed.success) continue;
    const normalizedLabel = parsed.data.label.toLocaleLowerCase("en-US");
    if (labels.has(normalizedLabel)) continue;
    labels.add(normalizedLabel);
    sessionTypes.push(parsed.data);
  }
  return sessionTypes.length > 0 ? sessionTypes : [...DEFAULT_SESSION_TYPES];
}

export function resolveEventSessionTypes(settingsJson: string): SessionTypeConfig[] {
  return resolveSessionTypes(
    parseJsonSafe<{ proposal?: { sessionTypes?: unknown[] } | null } | null>(settingsJson, {}),
  );
}

/** Presentation communication follows the current event policy, never the display name. */
export function eventSessionTypeRequiresPresentation(settingsJson: string, proposalType: string): boolean {
  return resolveEventSessionTypes(settingsJson).some(
    (type) =>
      type.label.toLocaleLowerCase("en-US") === proposalType.toLocaleLowerCase("en-US") && type.requiresPresentation,
  );
}

/** Returns the canonical configured label and rejects labels not enabled for this event. */
export function requireConfiguredSessionType(settingsJson: string, requestedType: string): string {
  const sessionTypes = resolveEventSessionTypes(settingsJson);
  const requested = requestedType.toLocaleLowerCase("en-US");
  const configured = sessionTypes.find((sessionType) => sessionType.label.toLocaleLowerCase("en-US") === requested);
  if (!configured) {
    throw new AppError(400, "PROPOSAL_TYPE_NOT_ALLOWED", "This session type is not enabled for the event", {
      allowedSessionTypes: sessionTypes.map((sessionType) => sessionType.label),
    });
  }
  return configured.label;
}

export interface EventFrontendRoutes {
  registrationPath: string;
  registrationConfirmPath: string;
  proposalPath: string;
  registrationManagePath: string;
  proposalManagePath: string;
  speakerManagePath: string;
  speakerPresentationPath: string;
  inviteDeclinePath: string;
  usedFallback: boolean;
  fallbackKeys: string[];
}

function defaultFrontendPaths(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at">,
): Omit<EventFrontendRoutes, "usedFallback" | "fallbackKeys"> {
  const base = deriveEventBasePath(event);
  return {
    registrationPath: buildEventFlowPath(base, "registration"),
    registrationConfirmPath: buildEventFlowPath(base, "registrationConfirm"),
    proposalPath: buildEventFlowPath(base, "proposal"),
    registrationManagePath: buildEventFlowPath(base, "registrationManage"),
    proposalManagePath: buildEventFlowPath(base, "proposalManage"),
    speakerManagePath: buildEventFlowPath(base, "speakerManage"),
    speakerPresentationPath: buildEventFlowPath(base, "speakerPresentation"),
    inviteDeclinePath: buildEventFlowPath(base, "inviteDecline"),
  };
}

function normalizeFrontendPath(value: string | undefined, basePath?: string): string | null {
  if (!value?.trim()) return null;
  const trimmed = value.trim();
  let resolved: string;
  if (trimmed.startsWith("/")) resolved = trimmed;
  else if (basePath) resolved = `${basePath.endsWith("/") ? basePath : `${basePath}/`}${trimmed}`;
  else resolved = `/${trimmed}`;
  return resolved.endsWith("/") ? resolved : `${resolved}/`;
}

/**
 * Registration modes whose registration flow may be offered. The flow's
 * submission still enforces who may register under `optional` and `required`.
 */
const OFFERED_REGISTRATION_MODES = new Set(["open", "invite_or_open", "public", "optional", "required"]);

/**
 * Where a person registers for the event, when its registration flow is open
 * to them; null when the event has no public page or registration is closed.
 * Every event projection links registration through this one path.
 */
/** Only a public event has public pages; any other event is visible only after sign-in, in the portal. */
export function eventHasPublicPages(event: Pick<EventRecord, "visibility">): boolean {
  return event.visibility === "public";
}

/** The event's public page, when it has one to link to. */
export function eventPublicPagePath(event: Pick<EventRecord, "base_path" | "visibility">): string | null {
  return eventHasPublicPages(event) ? event.base_path : null;
}

export function eventRegistrationPath(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json" | "registration_mode"> &
    Partial<Pick<EventRecord, "source_mode">>,
): string | null {
  return event.base_path && OFFERED_REGISTRATION_MODES.has(event.registration_mode)
    ? resolveEventFrontendRoutes(event).registrationPath
    : null;
}

export function resolveEventFrontendRoutes(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json"> &
    Partial<Pick<EventRecord, "source_mode">>,
): EventFrontendRoutes {
  const basePath = deriveEventBasePath(event);
  const defaults = defaultFrontendPaths(event);
  // Portal routes are platform-owned and immutable. Custom frontend paths are
  // publication metadata for Hugo-authored events only.
  const routes =
    event.source_mode === "portal"
      ? {}
      : (parseJsonSafe<EventSettings>(event.settings_json, {}).frontend?.routes ?? {});
  const configured: Record<keyof EventSettingsRoutes, string | null> = {
    registration: normalizeFrontendPath(routes.registration, basePath),
    registrationConfirm: normalizeFrontendPath(routes.registrationConfirm, basePath),
    proposal: normalizeFrontendPath(routes.proposal, basePath),
    registrationManage: normalizeFrontendPath(routes.registrationManage, basePath),
    proposalManage: normalizeFrontendPath(routes.proposalManage, basePath),
    speakerManage: normalizeFrontendPath(routes.speakerManage, basePath),
    speakerPresentation: normalizeFrontendPath(routes.speakerPresentation, basePath),
    inviteDecline: normalizeFrontendPath(routes.inviteDecline, basePath),
  };
  const fallbackKeys = Object.entries(configured)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    registrationPath: configured.registration ?? defaults.registrationPath,
    registrationConfirmPath: configured.registrationConfirm ?? defaults.registrationConfirmPath,
    proposalPath: configured.proposal ?? defaults.proposalPath,
    registrationManagePath: configured.registrationManage ?? defaults.registrationManagePath,
    proposalManagePath: configured.proposalManage ?? defaults.proposalManagePath,
    speakerManagePath: configured.speakerManage ?? defaults.speakerManagePath,
    speakerPresentationPath: configured.speakerPresentation ?? defaults.speakerPresentationPath,
    inviteDeclinePath: configured.inviteDecline ?? defaults.inviteDeclinePath,
    usedFallback: fallbackKeys.length > 0,
    fallbackKeys,
  };
}

const publishedContentMedia = new Set(contentMediaPaths);

export function resolveHeroImageUrl(event: Pick<EventRecord, "settings_json">): string | null {
  const settings = parseJsonSafe<{ heroImageUrl?: string | null }>(event.settings_json, {});
  const image = settings?.heroImageUrl;
  return typeof image === "string" && image.trim() ? resolveContentMediaUrl(image.trim(), publishedContentMedia) : null;
}

export function resolveEventVenue(event: Pick<EventRecord, "settings_json">): string | null {
  return parseJsonSafe<EventSettings>(event.settings_json, {}).venue?.trim() || null;
}
