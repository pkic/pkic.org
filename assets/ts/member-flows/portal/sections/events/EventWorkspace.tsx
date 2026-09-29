import { lazy, Suspense } from "preact/compat";
import { useEffect } from "preact/hooks";
import { EventAudienceView } from "./EventAudienceView";
import { eventDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { PageHeader } from "../../../../ui/PageHeader";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
import { portalSession } from "../../state";
import { portalHasPermissionAtAnyScope } from "../../shell/portal-navigation";
import type { PortalSession } from "../../types";

const ParticipantEvent = lazy(() =>
  import("./ParticipantEvent").then((module) => ({ default: module.ParticipantEvent })),
);
const ParticipantEventPage = lazy(() =>
  import("./ParticipantEvent").then((module) => ({ default: module.ParticipantEventPage })),
);

const EventList = lazy(() => import("./EventList").then((module) => ({ default: module.EventList })));
const ProposalPrograms = lazy(() =>
  import("../management/ProposalPrograms").then((module) => ({ default: module.ProposalPrograms })),
);
type EventWorkspaceProps =
  | { view: "list" }
  | { view: "participant"; slug: string; kind: "registration" | "proposal"; resourceId: string; tab?: string }
  | { view: "detail"; slug: string; tab?: string; subTab?: string; detailSegment?: string }
  | { view: "proposal"; slug: string; resourceId: string; tab?: string; segment?: string }
  | { view: "registration"; slug: string; resourceId: string };

/**
 * Canonical event management lives in groups. These legacy routes only
 * resolve an event to its owning group; they never provide an independent
 * system-level management workspace.
 */
function LegacyEventRoute({
  slug,
  mapPath,
  audienceFallback = false,
  audienceTab,
}: {
  slug: string;
  mapPath: (base: string) => string;
  audienceFallback?: boolean;
  audienceTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const detail = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventDetailResponseSchema),
    [slug],
  );
  const event = detail.data?.event;
  const ownerGroupId = event && "ownerGroupId" in event ? event.ownerGroupId : null;
  const eventId = detail.data?.event.id ?? null;
  const personal =
    audienceFallback &&
    Boolean(
      event?.participation?.registrationId || event?.participation?.proposals || event?.participation?.speakerProposals,
    );
  const target =
    !personal && ownerGroupId && eventId
      ? mapPath(`/groups/${encodeURIComponent(ownerGroupId)}/events/${encodeURIComponent(eventId)}`)
      : null;

  const fallbackTarget = !detail.loading && !detail.error && event && !target && !audienceFallback ? "/events" : null;

  useEffect(() => {
    const destination = target ?? fallbackTarget;
    if (destination) navigate(destination, { replace: true });
  }, [target, fallbackTarget, navigate]);

  if (detail.loading) return <Spinner label="Loading event…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (target || fallbackTarget) return null;
  if (personal && event) return <ParticipantEvent event={event} tab={audienceTab} />;
  if (audienceFallback && event && "viewer" in event) return <EventAudienceView event={event} />;
  return null;
}

/**
 * ProposalPrograms is the proposal-only surface for identities that cannot
 * see the events management list at all; an events:read holder manages
 * proposals through the event detail workspace instead, so showing both
 * here would duplicate the same proposals twice.
 */
export function eventListShowsProposalPrograms(session: PortalSession | null): boolean {
  return (
    portalHasPermissionAtAnyScope(session, "proposals:read") && !portalHasPermissionAtAnyScope(session, "events:read")
  );
}

export function EventWorkspace(props: EventWorkspaceProps) {
  if (props.view === "participant")
    return (
      <div class="pk pk-stack portal-section">
        <Suspense fallback={<Spinner />}>
          <ParticipantEventPage slug={props.slug} kind={props.kind} resourceId={props.resourceId} tab={props.tab} />
        </Suspense>
      </div>
    );
  if (props.view === "list") {
    // The list is a page of its own, so it opens with the anatomy's first
    // region rather than the workspace's legacy heading.
    return (
      <div class="pk pk-stack portal-section">
        <PageHeader title="Events" />
        <Suspense fallback={<Spinner />}>
          <div class="pk-stack">
            <EventList />
            {eventListShowsProposalPrograms(portalSession.value) && <ProposalPrograms />}
          </div>
        </Suspense>
      </div>
    );
  }

  let content;
  if (props.view === "proposal") {
    content = (
      <LegacyEventRoute
        slug={props.slug}
        mapPath={(base) =>
          `${base}/proposals/${encodeURIComponent(props.resourceId)}${props.tab ? `/${encodeURIComponent(props.tab)}` : ""}${
            props.segment ? `/${encodeURIComponent(props.segment)}` : ""
          }`
        }
      />
    );
  } else if (props.view === "registration") {
    content = (
      <LegacyEventRoute
        slug={props.slug}
        mapPath={(base) => `${base}/registrations/${encodeURIComponent(props.resourceId)}`}
      />
    );
  } else {
    const tab = props.tab;
    const subTab = props.subTab;
    content = (
      <LegacyEventRoute
        slug={props.slug}
        audienceFallback={!tab || tab === "overview" || tab === "submissions"}
        audienceTab={props.tab}
        mapPath={(base) => {
          if (!tab || tab === "overview") return base;
          // The group workspace flattened Team out of Settings, while the
          // other event sections kept their second URL segment. Preserve the
          // complete destination so bookmarked legacy URLs still open the
          // exact workflow they name instead of silently landing one level
          // too high.
          if (tab === "settings" && subTab === "team") {
            return `${base}/team${props.detailSegment ? `/${encodeURIComponent(props.detailSegment)}` : ""}`;
          }
          if (tab === "settings") return `${base}/settings`;
          return `${base}/${encodeURIComponent(tab)}${subTab ? `/${encodeURIComponent(subTab)}` : ""}`;
        }}
      />
    );
  }
  return (
    <div class="pk pk-stack portal-section">
      <Suspense fallback={<Spinner />}>{content}</Suspense>
    </div>
  );
}

export type { EventWorkspaceProps };
