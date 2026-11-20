import { logInfo } from "../logging";
import { resolveEventFrontendRoutes, type EventRecord } from "./events";
import {
  eventMyAgendaPath,
  eventPortalRegistrationPath,
  eventPortalRegistrationRecordPath,
  eventPromotionKitPath,
} from "../../../assets/shared/event-participation-link";

type EventRouteSource = Pick<EventRecord, "slug" | "base_path" | "starts_at" | "settings_json" | "source_mode">;
/** Registration links also need the audience: only a public event has public registration pages. */
export type RegistrationRouteSource = EventRouteSource & Pick<EventRecord, "visibility">;

/**
 * The one rule for where registration links open: a public event has public
 * registration pages; any other event is visible only after sign-in, so its
 * registration and management open in the portal.
 */
export function registrationOpensInPortal(event: Pick<EventRecord, "visibility">): boolean {
  return event.visibility !== "public";
}

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

type RegistrationEntryLinkQuery = {
  invite?: string;
  inviteId?: string | null;
  ref?: string;
  source?: string;
  event?: string;
};

/**
 * Where an invitation, reminder or referral sends someone to register. A
 * public event registers on its public page; any other event is visible only
 * after sign-in, so the link opens registration in the portal, which returns
 * there after sign-in with the invitation still attached.
 */
export function registrationPageUrl(
  appBaseUrl: string,
  event: RegistrationRouteSource,
  query: RegistrationEntryLinkQuery = {},
): string {
  if (registrationOpensInPortal(event))
    return new URL(
      eventPortalRegistrationPath(event.slug, {
        invite: query.invite,
        id: query.inviteId,
        ref: query.ref,
        source: query.source,
      }),
      appBaseUrl,
    ).toString();
  return publicRegistrationPageUrl(appBaseUrl, event, query);
}

/** The public event's own registration page. */
function publicRegistrationPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  query: RegistrationEntryLinkQuery = {},
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

/**
 * Where a registrant manages their registration. A public event's page opens
 * with the emailed token; any other event opens the registration in the
 * portal, which the registrant reaches by signing in with the same address.
 */
export function registrationManagePageUrl(
  appBaseUrl: string,
  event: RegistrationRouteSource,
  capability: { token: string; registrationId: string },
): string {
  if (registrationOpensInPortal(event))
    return new URL(eventPortalRegistrationRecordPath(event.slug, capability.registrationId), appBaseUrl).toString();
  return registrationTokenManagePageUrl(appBaseUrl, event, capability.token);
}

/** The token management page itself, for staff opening a registration with delegated access. */
export function registrationTokenManagePageUrl(appBaseUrl: string, event: EventRouteSource, token: string): string {
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

/** The speaker's promotion kit in the portal, for customizing it or taking other formats. */
export function promotionKitPageUrl(appBaseUrl: string, event: Pick<EventRouteSource, "slug">): string {
  return new URL(eventPromotionKitPath(event.slug), appBaseUrl).toString();
}

export function speakerParticipationPageUrl(
  appBaseUrl: string,
  event: EventRouteSource,
  proposalId: string,
  speakerUserId?: string,
): string {
  const url = new URL(
    `/portal/#/events/${encodeURIComponent(event.slug)}/proposals/${encodeURIComponent(proposalId)}/participation`,
    appBaseUrl,
  );
  if (speakerUserId) url.hash += `?speaker=${encodeURIComponent(speakerUserId)}`;
  return url.toString();
}

/** Opens the organizer roster where an authorized reviewer can decide late participation. */
export function proposalSpeakerReviewPageUrl(
  appBaseUrl: string,
  event: Pick<EventRecord, "id" | "slug" | "owner_group_id">,
  proposalId: string,
): string {
  const workspace = event.owner_group_id
    ? `/groups/${encodeURIComponent(event.owner_group_id)}/events/${encodeURIComponent(event.id)}`
    : `/events/${encodeURIComponent(event.slug)}`;
  return new URL(`/portal/#${workspace}/proposals/${encodeURIComponent(proposalId)}/speakers`, appBaseUrl).toString();
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
