import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect } from "preact/hooks";
import { eventManagementDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { Spinner } from "../../../../components/Spinner";
import { PageHeader } from "../../../../ui/PageHeader";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
import { portalSession } from "../../state";
import { portalHasPermissionAtAnyScope } from "../../shell/portal-navigation";
import type { PortalSession } from "../../types";

const EventList = lazy(() => import("./EventList").then((module) => ({ default: module.EventList })));
const ProposalPrograms = lazy(() =>
  import("../management/ProposalPrograms").then((module) => ({ default: module.ProposalPrograms })),
);
const EventDetailView = lazy(() =>
  import("./detail/EventDetail").then((module) => ({ default: module.EventDetailView })),
);
const ProposalDetailPage = lazy(() =>
  import("./detail/ProposalDetailPage").then((module) => ({ default: module.ProposalDetailPage })),
);
const RegistrationDetailPage = lazy(() =>
  import("./detail/RegistrationDetailPage").then((module) => ({ default: module.RegistrationDetailPage })),
);

type EventWorkspaceProps =
  | { view: "list" }
  | { view: "detail"; slug: string; tab?: string; subTab?: string }
  | { view: "proposal"; slug: string; resourceId: string }
  | { view: "registration"; slug: string; resourceId: string };

/**
 * Canonical event homes are groups. A management view for a group-owned
 * event redirects to the owning group's event workspace; only events
 * without an owning group keep the standalone surface. Fetch errors fall
 * back to the standalone view, whose own components explain them.
 */
function OwnerGroupGate({
  slug,
  mapPath,
  children,
}: {
  slug: string;
  mapPath: (base: string) => string;
  children: ComponentChildren;
}) {
  const [, navigate] = usePortalHashLocation();
  const detail = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventManagementDetailResponseSchema),
    [slug],
  );
  const ownerGroupId = detail.data?.event.ownerGroupId ?? null;
  const eventId = detail.data?.event.id ?? null;
  const target =
    ownerGroupId && eventId
      ? mapPath(`/groups/${encodeURIComponent(ownerGroupId)}/events/${encodeURIComponent(eventId)}`)
      : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target, navigate]);

  if (detail.loading) return <Spinner label="Loading event…" />;
  if (target) return null;
  return <>{children}</>;
}

/**
 * ProposalPrograms is the proposal-only surface for identities that cannot
 * see the events management list at all; an events:read holder manages
 * proposals through the event detail workspace instead, so showing both
 * here would duplicate the same proposals twice.
 */
export function eventListShowsProposalPrograms(session: PortalSession | null): boolean {
  return !portalHasPermissionAtAnyScope(session, "events:read");
}

export function EventWorkspace(props: EventWorkspaceProps) {
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

  // The record pages below open with their own subject heading, so the
  // workspace adds no generic "Event"/"Proposal" title above them — that
  // label named the route, not the record, and repeated what the page's own
  // heading was about to say.
  let content: ComponentChildren;
  if (props.view === "proposal") {
    content = (
      <OwnerGroupGate slug={props.slug} mapPath={(base) => `${base}/proposals/${encodeURIComponent(props.resourceId)}`}>
        <ProposalDetailPage slug={props.slug} proposalId={props.resourceId} />
      </OwnerGroupGate>
    );
  } else if (props.view === "registration") {
    content = (
      <OwnerGroupGate
        slug={props.slug}
        mapPath={(base) => `${base}/registrations/${encodeURIComponent(props.resourceId)}`}
      >
        <RegistrationDetailPage slug={props.slug} regId={props.resourceId} />
      </OwnerGroupGate>
    );
  } else {
    const tab = props.tab;
    const subTab = props.subTab;
    content = (
      <OwnerGroupGate
        slug={props.slug}
        mapPath={(base) => {
          if (!tab || tab === "overview") return base;
          if (tab === "promoters" && subTab) return `${base}/promoters/${encodeURIComponent(subTab)}`;
          // Settings sub-keys have no group-side segment; land on the tab.
          return `${base}/${encodeURIComponent(tab)}`;
        }}
      >
        <EventDetailView slug={props.slug} tab={props.tab} subTab={props.subTab} />
      </OwnerGroupGate>
    );
  }
  return (
    <div class="pk pk-stack portal-section">
      <Suspense fallback={<Spinner />}>{content}</Suspense>
    </div>
  );
}

export type { EventWorkspaceProps };
