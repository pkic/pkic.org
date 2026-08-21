import { parseJsonSafe } from "../utils/json";
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
  proposal?: { sessionTypes?: Array<{ label: string; requiresPresentation: boolean }> };
}

export interface SessionTypeConfig {
  label: string;
  requiresPresentation: boolean;
}

const DEFAULT_SESSION_TYPES: SessionTypeConfig[] = [
  { label: "talk", requiresPresentation: true },
  { label: "keynote", requiresPresentation: true },
  { label: "panel", requiresPresentation: true },
];

/** Normalizes both current session-type objects and legacy string entries. */
export function resolveSessionTypes(settings: { proposal?: { sessionTypes?: unknown[] } }): SessionTypeConfig[] {
  const raw = settings.proposal?.sessionTypes;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_SESSION_TYPES;
  return raw.map((entry) => {
    if (typeof entry === "string") return { label: entry, requiresPresentation: true };
    return entry as SessionTypeConfig;
  });
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

type EventEmailSource = Pick<EventRecord, "name" | "slug" | "base_path" | "starts_at" | "settings_json"> &
  Partial<Pick<EventRecord, "timezone" | "ends_at">>;

export interface EventEmailVariables {
  eventName: string;
  eventSlug: string;
  eventTimezone: string;
  eventStartsAt: string;
  eventEndsAt: string;
  eventUrl: string;
}

function getEventBasePath(event: Pick<EventRecord, "slug" | "base_path" | "starts_at">): string {
  if (event.base_path) return event.base_path;
  if (event.starts_at) {
    const year = event.starts_at.substring(0, 4);
    if (/^\d{4}$/.test(year)) return `/events/${year}/${event.slug}/`;
  }
  return `/events/${event.slug}/`;
}

function defaultFrontendPaths(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at">,
): Omit<EventFrontendRoutes, "usedFallback" | "fallbackKeys"> {
  const base = getEventBasePath(event);
  return {
    registrationPath: `${base}register/`,
    registrationConfirmPath: `${base}register/confirm/`,
    proposalPath: `${base}propose/`,
    registrationManagePath: `${base}register/manage/`,
    proposalManagePath: `${base}propose/manage/`,
    speakerManagePath: `${base}propose/speaker/`,
    speakerPresentationPath: `${base}propose/presentation/`,
    inviteDeclinePath: `${base}invite/decline/`,
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

export function resolveEventFrontendRoutes(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">,
): EventFrontendRoutes {
  const basePath = getEventBasePath(event);
  const defaults = defaultFrontendPaths(event);
  const routes = parseJsonSafe<EventSettings>(event.settings_json, {}).frontend?.routes ?? {};
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

export function resolveSponsorsImageUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">,
  siteBaseUrl: string,
): string | null {
  const settings = parseJsonSafe<{ sponsorsImageUrl?: string | null }>(event.settings_json, {});
  if ("sponsorsImageUrl" in settings) return settings.sponsorsImageUrl?.trim() || null;
  return `${siteBaseUrl}${getEventBasePath(event)}sponsors.jpg`;
}

export function resolveHeroImageUrl(event: Pick<EventRecord, "settings_json">): string | null {
  const settings = parseJsonSafe<{ heroImageUrl?: string | null }>(event.settings_json, {});
  return "heroImageUrl" in settings ? settings.heroImageUrl?.trim() || null : null;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function normalizeEventHeroImageUrl(value: string, siteBaseUrl: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.origin === new URL(siteBaseUrl).origin || isLoopbackHostname(url.hostname)) {
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // Request-boundary validation owns malformed URL errors.
  }
  return trimmed;
}

export function resolveEventVenue(event: Pick<EventRecord, "settings_json">): string | null {
  return parseJsonSafe<EventSettings>(event.settings_json, {}).venue?.trim() || null;
}

export function resolveEventVirtualUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">,
  siteBaseUrl: string,
): string | null {
  const explicit = parseJsonSafe<EventSettings>(event.settings_json, {}).virtualUrl?.trim();
  return explicit || `${siteBaseUrl}${getEventBasePath(event)}virtual/`;
}

export function resolveEventUrl(
  event: Pick<EventRecord, "slug" | "base_path" | "starts_at">,
  siteBaseUrl: string,
): string {
  return `${siteBaseUrl}${getEventBasePath(event)}`;
}

export function buildEventEmailVariables(event: EventEmailSource, siteBaseUrl: string): EventEmailVariables {
  return {
    eventName: event.name,
    eventSlug: event.slug,
    eventTimezone: event.timezone ?? "",
    eventStartsAt: event.starts_at ?? "",
    eventEndsAt: event.ends_at ?? "",
    eventUrl: resolveEventUrl(event, siteBaseUrl),
  };
}
