import { logInfo } from "../logging";
import { resolveEventFrontendRoutes, type EventRecord } from "./events";
import { eventMyAgendaPath } from "../../../assets/shared/event-participation-link";

type EventRouteSource = Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json" | "source_mode">;

function buildUrl(appBaseUrl: string, path: string, query: Record<string, string | undefined | null>): string {
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
  const noisyFallbackKeys = routes.fallbackKeys.filter(
    (key) => key !== "speakerManage" && key !== "speakerPresentation" && key !== "inviteDecline",
  );
  if (noisyFallbackKeys.length > 0) {
    logInfo("EVENT_FRONTEND_ROUTES_FALLBACK", {
      eventSlug: event.slug,
      fallbackKeys: noisyFallbackKeys,
    });
  }
  return routes;
}

export function registrationPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  query: {
    invite?: string;
    inviteId?: string | null;
    ref?: string;
    source?: string;
    event?: string;
  } = {},
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.registrationPath, {
    event: query.event ?? event.slug,
    invite: query.invite,
    id: query.inviteId,
    ref: query.ref,
    source: query.source,
  });
}

export function registrationConfirmPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  token: string,
  registrationId?: string | null,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.registrationConfirmPath, {
    event: event.slug,
    id: registrationId,
    token,
  });
}

export function registrationManagePageUrl(appBaseUrl: string, event: EventRouteSource, token: string): string {
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
  inviteId?: string | null,
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.inviteDeclinePath, { id: inviteId, token: inviteToken });
}

export function proposalPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  query: {
    invite?: string;
    inviteId?: string | null;
    ref?: string;
    source?: string;
    event?: string;
  } = {},
): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.proposalPath, {
    event: query.event ?? event.slug,
    invite: query.invite,
    id: query.inviteId,
    ref: query.ref,
    source: query.source,
  });
}

export function proposalManagePageUrl(appBaseUrl: string, event: EventRouteSource, token: string): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.proposalManagePath, {
    event: event.slug,
    token,
  });
}

/** The attendee's own agenda in the portal; it resolves live sessions and standing after sign-in. */
export function myAgendaPageUrl(appBaseUrl: string, event: Pick<EventRouteSource, "slug">): string {
  return new URL(eventMyAgendaPath(event.slug), appBaseUrl).toString();
}

export function speakerParticipationPageUrl(appBaseUrl: string, event: EventRouteSource, proposalId: string): string {
  return new URL(
    `/portal/#/events/${encodeURIComponent(event.slug)}/proposals/${encodeURIComponent(proposalId)}/participation`,
    appBaseUrl,
  ).toString();
}

export function speakerManagePageUrl(appBaseUrl: string, event: EventRouteSource, token: string): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.speakerManagePath, {
    event: event.slug,
    token,
  });
}

export function speakerPresentationPageUrl(appBaseUrl: string, event: EventRouteSource, token: string): string {
  const routes = routesForEvent(event);
  return buildUrl(appBaseUrl, routes.speakerPresentationPath, {
    event: event.slug,
    token,
  });
}
