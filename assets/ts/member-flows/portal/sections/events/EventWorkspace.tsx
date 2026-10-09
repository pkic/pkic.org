import { scannerPermission, availableScannerActions } from "../../../../../shared/event-scanner-permissions";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo } from "preact/hooks";
import { Field } from "../../../../ui/Field";
import { Select } from "../../../../ui/TextControl";
import { hasEventAgendaPermission } from "./event-agenda-access";
import { eventDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { PageHeader } from "../../../../ui/PageHeader";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { usePortalHashLocation } from "../../hash-location";
import { portalSession } from "../../state";
import { portalHasPermissionAtAnyScope } from "../../shell/portal-navigation";
import { canOpenGroupWorkspace } from "./event-destination";
import type { PortalSession } from "../../types";
import { createScannerEventBootstrap } from "./detail/scanner/scanner-event-bootstrap";
import { databaseIdSchema } from "../../../../../shared/schemas/identifiers";
import { readHashQueryParam } from "../../../../shared/hash-query";
import { ScannerEventNavigation } from "./ParticipantEventNavigation";
import { eventAgendaRoute } from "../../../../../shared/event-participation-link";

const scannerEventBootstrap = createScannerEventBootstrap(() => portalSession.value);

const EventScanner = lazy(() =>
  import("./detail/scanner/EventScanner").then((module) => ({ default: module.EventScanner })),
);
const SponsorLeads = lazy(() =>
  import("./detail/agenda/SponsorLeads").then((module) => ({ default: module.SponsorLeads })),
);
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

function ScopedSponsorLeadsRoute({ slug }: { slug: string }) {
  const event = useData(() => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventDetailResponseSchema), [slug]);
  if (event.loading) return <Spinner label="Loading sponsor leads…" />;
  if (event.error || !event.data) return <ErrorAlert error={event.error ?? "Event unavailable"} />;
  const detail = event.data.event;
  if (!("sponsorLeadAccess" in detail) || !detail.sponsorLeadAccess) {
    return (
      <ErrorAlert error="Your current identity does not have permission to view or export sponsor leads for this event." />
    );
  }
  return (
    <div class="pk pk-stack portal-section">
      <PageHeader
        title={detail.name}
        trail={[{ label: "Events", href: usePortalHashLocation.hrefs("/events") }, { label: "Sponsor leads" }]}
      />
      <Suspense fallback={<Spinner label="Loading sponsor leads…" />}>
        <SponsorLeads slug={slug} timeZone={detail.timezone} />
      </Suspense>
    </div>
  );
}

function ScopedScannerRoute({ slug, sponsorId }: { slug: string; sponsorId?: string }) {
  const [, navigate] = usePortalHashLocation();
  const session = portalSession.value;
  const request = useMemo(() => new AbortController(), [slug, sponsorId, session?.sessionId, session?.identity.id]);
  useEffect(() => () => request.abort(), [request]);
  const event = useData(() => scannerEventBootstrap.load(slug, sponsorId, request.signal), [request]);
  if (event.loading) return <Spinner label="Loading event scanner…" />;
  if (event.error || !event.data) return <ErrorAlert error={event.error ?? "Event unavailable"} />;
  const scannerAccess = "scannerAccess" in event.data.event ? event.data.event.scannerAccess : undefined;
  const permission = sponsorId ? "agenda:leads_capture" : "agenda:scan";
  const can = (value: import("../../../../../shared/schemas/permissions").Permission) =>
    hasEventAgendaPermission(event.data!.event.id, value, sponsorId);
  const allowedActions = availableScannerActions(can);
  if (
    sponsorId
      ? !can(permission as "agenda:leads_capture") ||
        !scannerAccess?.sponsors.some((sponsor) => sponsor.id === sponsorId)
      : !allowedActions.length || !scannerAccess?.canScan
  )
    return <ErrorAlert error="Your current identity does not have permission to scan for this event." />;
  const selectedSession = sponsorId ? null : readHashQueryParam("session");
  const target = selectedSession === null ? null : databaseIdSchema.safeParse(selectedSession);
  if (target && !target.success) return <ErrorAlert error="This session is not available for check-in." />;
  return (
    <div class="pk pk-stack portal-section">
      <PageHeader
        title={event.data.event.name}
        trail={[
          { label: "Events", href: usePortalHashLocation.hrefs("/events") },
          { label: sponsorId ? "Lead scanner" : "Scanner" },
        ]}
      />
      <ScannerEventNavigation
        event={{ ...event.data.event, slug }}
        activeId={sponsorId ? "lead-scanner" : "scanner"}
        items={[
          {
            id: "overview",
            label: "Overview",
            href: usePortalHashLocation.hrefs(`/events/${encodeURIComponent(slug)}`),
          },
          { id: "programme", label: "Agenda", href: usePortalHashLocation.hrefs(eventAgendaRoute(slug)) },
          {
            id: "agenda",
            label: "My agenda",
            href: usePortalHashLocation.hrefs(eventAgendaRoute(slug, { mine: true })),
          },
        ]}
      />
      {scannerAccess && scannerAccess.sponsors.length + Number(scannerAccess.canScan) > 1 && (
        <Field label="Scanning context">
          {(control) => (
            <Select
              {...control}
              value={sponsorId ?? "event"}
              onChange={(change) =>
                navigate(
                  change.currentTarget.value === "event"
                    ? `/events/${encodeURIComponent(slug)}/scanner`
                    : `/events/${encodeURIComponent(slug)}/sponsors/${encodeURIComponent(change.currentTarget.value)}/scanner`,
                )
              }
            >
              {scannerAccess.canScan && <option value="event">Event admission and attendance</option>}
              {scannerAccess.sponsors.map((sponsor) => (
                <option value={sponsor.id}>Lead capture · {sponsor.name}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Suspense fallback={<Spinner />}>
        <EventScanner
          key={`${slug}:${sponsorId ?? "event"}:${target?.success ? target.data : "entrance"}:${portalSession.value?.identity.id ?? ""}`}
          slug={slug}
          occurrenceId={target?.success ? target.data : null}
          allowedActions={
            sponsorId
              ? ["lead"]
              : [
                  ...allowedActions,
                  ...(can("agenda:admit_exceptions") && scannerPermission(can, "agenda:admit")
                    ? ["exception" as const]
                    : []),
                ]
          }
          sponsorId={sponsorId}
          canExportLeads={Boolean(
            sponsorId &&
            portalSession.value?.staff?.grants.some(
              (grant) =>
                grant.permission === "agenda:leads_export" &&
                grant.contextType === "event_sponsor" &&
                grant.contextId === sponsorId,
            ),
          )}
          operatorUserId={portalSession.value?.identity.id ?? ""}
          canAdmitExceptions={
            !sponsorId && can("agenda:admit_exceptions") && Boolean(scannerPermission(can, "agenda:admit"))
          }
        />
      </Suspense>
    </div>
  );
}

/**
 * Canonical event management lives in groups. These legacy routes resolve an
 * event to its owning group only for a caller who can open that group's
 * workspace; they never provide an independent system-level management
 * workspace. Everyone else — and every attendee-facing tab — gets the
 * group-independent event page, never a redirect into a refusal.
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
  const target =
    !audienceFallback && ownerGroupId && eventId && canOpenGroupWorkspace(portalSession.value, ownerGroupId)
      ? mapPath(`/groups/${encodeURIComponent(ownerGroupId)}/events/${encodeURIComponent(eventId)}`)
      : null;

  useEffect(() => {
    if (target) navigate(target, { replace: true });
  }, [target, navigate]);

  if (detail.loading) return <Spinner label="Loading event…" />;
  if (detail.error) return <ErrorAlert error={detail.error} />;
  if (target || !event) return null;
  // Every reader lands on the event app: the caller's own registration,
  // proposals, agenda, ticket and scanner tabs come from the caller-scoped
  // projection, and a reader who has none of them yet sees the event home
  // with its registration offer rather than a separate plain detail page.
  return <ParticipantEvent event={event} tab={audienceFallback ? audienceTab : undefined} />;
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
  const session = portalSession.value;
  useEffect(() => scannerEventBootstrap.sessionChanged(), [session?.sessionId, session?.identity.id]);
  if (props.view === "detail" && props.tab === "lead-scanner")
    return (
      <div class="pk pk-stack portal-section">
        <Suspense fallback={<Spinner />}>
          <ParticipantEventPage slug={props.slug} tab="lead-scanner" />
        </Suspense>
      </div>
    );
  if (props.view === "detail" && props.tab === "leads") return <ScopedSponsorLeadsRoute slug={props.slug} />;
  if (
    props.view === "detail" &&
    (props.tab === "scanner" || (props.tab === "sponsors" && props.subTab && props.detailSegment === "scanner"))
  )
    return <ScopedScannerRoute slug={props.slug} sponsorId={props.tab === "sponsors" ? props.subTab : undefined} />;
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
        audienceFallback={
          !tab ||
          tab === "overview" ||
          tab === "submissions" ||
          tab === "agenda" ||
          tab === "promotion" ||
          tab === "session-management" ||
          tab === "ticket" ||
          tab === "more"
        }
        audienceTab={props.tab}
        mapPath={(base) => {
          if (!tab || tab === "overview") return base;
          const section =
            tab === "team"
              ? "settings/team"
              : tab === "promoters"
                ? "stats/promoters"
                : tab === "badges"
                  ? "registrations/badges"
                  : encodeURIComponent(tab);
          return `${base}/${section}${subTab ? `/${encodeURIComponent(subTab)}` : ""}${props.detailSegment ? `/${encodeURIComponent(props.detailSegment)}` : ""}`;
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
