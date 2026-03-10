import { logInfo } from "../logging";
import { resolveEventFrontendRoutes, type EventRecord } from "./events";

type EventRouteSource = Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json">;;

function buildUrl(
  appBaseUrl: string,
  path: string,
  query: Record<string, string | undefined | null>,
): string {
  const url = new URL(path, appBaseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value && value.trim().length > 0) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function routesForEvent(event: EventRouteSource): ReturnType<typeof resolveEventFrontendRoutes> {
  const routes = resolveEventFrontendRoutes(event);
  if (routes.usedFallback) {
    logInfo("EVENT_FRONTEND_ROUTES_FALLBACK", {
      eventSlug: event.slug,
      fallbackKeys: routes.fallbackKeys,
    });
  }
  return routes;
}

export function registrationPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  query: {
    invite?: string;
    ref?: string;
    source?: string;
    event?: string;
  } = {},
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.registrationPath, {
    event: query.event ?? event.slug,
    invite: query.invite,
    ref: query.ref,
    source: query.source,
  });
}

export function registrationConfirmPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  token: string,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.registrationConfirmPath, {
    event: event.slug,
    token,
  });
}

export function registrationManagePageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  token: string,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.registrationManagePath, {
    event: event.slug,
    token,
  });
}

export function inviteDeclineUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  inviteToken: string,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.inviteDeclinePath, { token: inviteToken });
}

export function proposalPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  query: {
    invite?: string;
    ref?: string;
    source?: string;
    event?: string;
  } = {},
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.proposalPath, {
    event: query.event ?? event.slug,
    invite: query.invite,
    ref: query.ref,
    source: query.source,
  });
}

export function proposalManagePageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  token: string,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.proposalManagePath, {
    event: event.slug,
    token,
  });
}

export function speakerManagePageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  token: string,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.speakerManagePath, {
    event: event.slug,
    token,
  });
}
