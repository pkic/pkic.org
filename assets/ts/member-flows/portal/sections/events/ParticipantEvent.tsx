import { lazy, Suspense } from "preact/compat";
import { useEffect } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import {
  eventAgendaRoute,
  eventVirtualRoomRoute,
  isMyAgendaQuery,
} from "../../../../../shared/event-participation-link";
import type { ComponentChildren } from "preact";
import { eventParticipantRecordPath } from "./event-participant-paths";
import { useData } from "../../../../hooks/useData";
import { getJson, ApiClientError } from "../../../../shared/api-client";
import { eventDetailResponseSchema } from "../../../../../shared/schemas/event-management";
import type { z } from "zod";
import { currentUserProposalsListResponseSchema } from "../../../../../shared/schemas/current-user-proposals";
import { proposalAccessReadResponseSchema } from "../../../../../shared/schemas/proposal-management";
import { speakerSelfServiceReadResponseSchema } from "../../../../../shared/schemas/speaker-self-service";
import { eventFormsResponseSchema, eventTermsResponseSchema } from "../../../../../shared/schemas/forms";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import { ParticipantRegistration } from "../../../../components/events/ParticipantRegistration";
import { ParticipantSubmission } from "../../../../components/events/ParticipantSubmission";
import { ParticipantSpeaker } from "../../../../components/events/ParticipantSpeaker";
import { Spinner } from "../../../../components/Spinner";
import { Badge } from "../../../../components/Badge";
import { Tabs } from "../../../../ui/Tabs";
import { ParticipantEventNavigation, ParticipantLeadScanner } from "./ParticipantEventNavigation";
import { Alert } from "../../../../ui/Alert";
import { usePortalHashLocation } from "../../hash-location";
import { portalHashParam } from "../../hash-route";
import { EventAppHero, EventHome } from "./app/EventHome";
import { SectionHeading } from "../../../../ui/SectionHeading";
import { EventTicket } from "./app/EventTicket";
import { EventMore } from "./app/EventMore";
import { eventRegistrationStanding } from "./app/event-app-model";
import { hasEventProposals, hasEventPromotionMaterials, participantEventAppSubject } from "./app/event-app-tabs";

const EventRegister = lazy(() => import("./app/EventRegister").then((module) => ({ default: module.EventRegister })));
const MyAgenda = lazy(() => import("./detail/participation/MyAgenda").then((module) => ({ default: module.MyAgenda })));
const EventCheckIn = lazy(() => import("./app/EventCheckIn").then((module) => ({ default: module.EventCheckIn })));
const VirtualRoom = lazy(() =>
  import("./app/virtual-room/VirtualRoom").then((module) => ({ default: module.VirtualRoom })),
);
const MyPromotionKits = lazy(() =>
  import("./detail/agenda/MyPromotionKits").then((module) => ({ default: module.MyPromotionKits })),
);
const MySessionManagement = lazy(() =>
  import("./detail/participation/MySessionManagement").then((module) => ({ default: module.MySessionManagement })),
);
type EventDetail = z.infer<typeof eventDetailResponseSchema>["event"];
type Selection = {
  kind?: "registration" | "proposal";
  resourceId?: string;
  tab?: string;
  pointToken?: string;
};
const href = usePortalHashLocation.hrefs;
/** The compact header's title for each participant page other than the event home. */
const PAGE_LABELS: Record<string, string> = {
  registration: "Registration",
  program: "Agenda",
  agenda: "My agenda",
  promotion: "Share",
  "lead-scanner": "Lead scanner",
  "session-management": "My sessions",
  ticket: "Ticket",
  "check-in": "Check in",
  virtual: "Virtual room",
  more: "More",
};

export function ParticipantEventPage({ slug, ...selection }: Selection & { slug: string }) {
  const loaded = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventDetailResponseSchema),
    [slug],
  );
  if (loaded.loading) return <Spinner label="Loading event…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return <ParticipantEvent event={loaded.data.event} {...selection} onRegistered={loaded.reload} />;
}

export function ParticipantEvent({
  event,
  kind,
  resourceId,
  tab,
  pointToken,
  onRegistered,
}: Selection & { event: EventDetail; onRegistered?: () => Promise<void> }) {
  const [location, navigate] = useHashLocation();
  // One agenda route: the whole program, or with `?mine=1` the same view filtered to the reader's sessions.
  const mine = isMyAgendaQuery(new URLSearchParams(location.split("?", 2)[1] ?? ""));
  const base = `/events/${encodeURIComponent(event.slug)}`;
  // The ticket page follows the rule that lists its tab. A reader without a
  // registration lands on the event home, which offers registration instead.
  const ticketless = tab === "ticket" && !eventRegistrationStanding(event).registered;
  useEffect(() => {
    if (ticketless) navigate(base, { replace: true });
  }, [ticketless, base, navigate]);
  const registrationId = event.participation?.registrationId;
  const hasProposals = hasEventProposals(event);
  const active =
    kind === "registration"
      ? "registration"
      : kind === "proposal" || tab === "submissions"
        ? "proposals"
        : tab === "register"
          ? "register"
          : tab === "agenda"
            ? mine
              ? "agenda"
              : "program"
            : tab === "promotion"
              ? "promotion"
              : tab === "lead-scanner"
                ? "lead-scanner"
                : tab === "session-management"
                  ? "session-management"
                  : (tab === "ticket" && !ticketless) || tab === "more" || tab === "virtual" || tab === "check-in"
                    ? tab
                    : "overview";
  const tabs = [
    { id: "overview", label: "Overview", href: href(base) },
    { id: "program", label: "Agenda", href: href(eventAgendaRoute(event.slug)) },
    ...(tab === "register" ? [{ id: "register", label: "Register", href: href(base + "/register/") }] : []),
    ...(eventRegistrationStanding(event).status === "registered"
      ? [{ id: "agenda", label: "My agenda", href: href(eventAgendaRoute(event.slug, { mine: true })) }]
      : []),
    ...(eventRegistrationStanding(event).registered
      ? [
          { id: "ticket", label: "Ticket", href: href(base + "/ticket") },
          { id: "virtual", label: "Virtual room", href: href(eventVirtualRoomRoute(event.slug)) },
        ]
      : []),
    ...(registrationId
      ? [
          {
            id: "registration",
            label: "Registration",
            href: href(eventParticipantRecordPath(event.slug, "registration", registrationId)),
          },
        ]
      : []),
    ...(hasEventPromotionMaterials(event)
      ? [{ id: "promotion", label: "Share", href: href(base + "/promotion") }]
      : []),
    ...(hasProposals
      ? [
          {
            id: "proposals",
            label: "Proposals",
            href: href(base + "/submissions"),
          },
          { id: "session-management", label: "My sessions", href: href(base + "/session-management") },
        ]
      : []),
  ];
  const navigation = (
    <ParticipantEventNavigation event={participantEventAppSubject(event)} activeId={active} items={tabs} />
  );
  // Every page belongs to this event; the section title follows its persistent hero.
  const header = (recordTitle?: string) => (
    <>
      <EventAppHero event={event} />
      {navigation}
      {active !== "overview" && active !== "register" && (
        <SectionHeading level={3}>
          {kind === "proposal" ? (recordTitle ?? "Proposal") : (PAGE_LABELS[active] ?? "Proposals")}
        </SectionHeading>
      )}
    </>
  );
  return (
    <div class="pk-stack">
      {kind !== "proposal" && header()}
      {kind === "registration" && resourceId ? (
        <ParticipantRegistration
          registrationId={resourceId}
          eventId={event.id}
          slug={event.slug}
          focusDay={portalHashParam(window.location.hash, "day")}
        />
      ) : kind === "proposal" && resourceId ? (
        <ParticipantProposal event={event} proposalId={resourceId} facet={tab} header={header} />
      ) : tab === "register" ? (
        <Suspense fallback={<Spinner label="Loading registration…" />}>
          <EventRegister event={event} onRegistered={onRegistered} />
        </Suspense>
      ) : tab === "agenda" ? (
        <Suspense fallback={<Spinner />}>
          <MyAgenda
            slug={event.slug}
            eventId={event.id}
            eventName={event.name}
            mine={mine}
            canPersonalize={eventRegistrationStanding(event).status === "registered"}
          />
        </Suspense>
      ) : tab === "session-management" ? (
        <Suspense fallback={<Spinner />}>
          <MySessionManagement slug={event.slug} />
        </Suspense>
      ) : tab === "promotion" ? (
        <Suspense fallback={<Spinner />}>
          <MyPromotionKits
            slug={event.slug}
            attendeeEligible={eventRegistrationStanding(event).status === "registered"}
            speakerEligible={hasProposals}
            share={
              event.participation?.promotion
                ? {
                    shareUrl: new URL(event.participation.promotion.sharePath, window.location.origin).href,
                    badgeVersion: event.participation.promotion.badgeVersion,
                    eventName: event.name,
                    eventSlug: event.slug,
                  }
                : undefined
            }
          />
        </Suspense>
      ) : tab === "lead-scanner" ? (
        <ParticipantLeadScanner eventId={event.id} slug={event.slug} scannerAccess={event.scannerAccess} />
      ) : tab === "submissions" ? (
        <ParticipantProposals event={event} />
      ) : tab === "virtual" ? (
        <Suspense fallback={<Spinner />}>
          <VirtualRoom slug={event.slug} eventName={event.name} />
        </Suspense>
      ) : tab === "ticket" && !ticketless ? (
        <EventTicket event={event} />
      ) : tab === "check-in" ? (
        <Suspense fallback={<Spinner />}>
          <EventCheckIn slug={event.slug} pointToken={pointToken} />
        </Suspense>
      ) : tab === "more" ? (
        <EventMore event={event} />
      ) : (
        <EventHome event={event} />
      )}
    </div>
  );
}

function ParticipantProposals({ event }: { event: EventDetail }) {
  return (
    <ApiDataTable
      urlState="event-proposals"
      endpoint="/api/v1/users/current/proposals"
      responseSchema={currentUserProposalsListResponseSchema}
      params={{ eventId: event.id }}
      resolve={(data) => data.proposals}
      resolvePage={(data) => data.page}
      paginate
      caption="Your event proposals"
      columns={[
        {
          header: "Proposal",
          cell: (proposal) => (
            <a href={href(eventParticipantRecordPath(event.slug, "proposal", proposal.id))}>{proposal.title}</a>
          ),
        },
        { header: "Status", cell: (proposal) => <Badge status={proposal.status} /> },
        { header: "Your role", cell: (proposal) => (proposal.role === "submitter" ? "Submitter" : "Speaker") },
      ]}
    />
  );
}

async function optionalRecord<T>(request: Promise<T>): Promise<T | null> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) return null;
    throw error;
  }
}

function ParticipantProposal({
  event,
  proposalId,
  facet,
  header,
}: {
  event: EventDetail;
  proposalId: string;
  facet?: string;
  header: (title?: string) => ComponentChildren;
}) {
  const base = `/api/v1/proposals/${encodeURIComponent(proposalId)}`;
  const loaded = useData(async () => {
    const [submission, speaker, forms, speakerTerms] = await Promise.all([
      optionalRecord(getJson(base + "/submission", proposalAccessReadResponseSchema)),
      optionalRecord(getJson(base + "/participation", speakerSelfServiceReadResponseSchema)),
      getJson(
        `/api/v1/events/${encodeURIComponent(event.slug)}/forms/placements/proposal_submission`,
        eventFormsResponseSchema,
      ),
      getJson(`/api/v1/events/${encodeURIComponent(event.slug)}/terms?audience=speaker`, eventTermsResponseSchema),
    ]);
    if (
      (!submission && !speaker) ||
      (submission?.proposal.event_id && submission.proposal.event_id !== event.id) ||
      (speaker?.proposal.eventId && speaker.proposal.eventId !== event.id)
    )
      throw new Error("Proposal not found for this event.");
    return { submission, speaker, forms, speakerTerms };
  }, [proposalId, event.id]);
  if (loaded.loading)
    return (
      <>
        {header()}
        <Spinner label="Loading proposal…" />
      </>
    );
  if (!loaded.data)
    return (
      <>
        {header()}
        <Alert tone="danger">{loaded.error}</Alert>
      </>
    );
  const { submission, speaker, forms, speakerTerms } = loaded.data;
  const route = eventParticipantRecordPath(event.slug, "proposal", proposalId);
  const active = facet ?? (submission ? "submission" : "participation");
  return (
    <div class="pk-stack">
      {header(submission?.proposal.title ?? speaker?.proposal.title)}
      <Tabs
        label="Proposal"
        activeId={active}
        items={[
          ...(submission
            ? [
                { id: "submission", label: "Submission", href: href(route) },
                { id: "speakers", label: "Speakers", href: href(route + "/speakers") },
              ]
            : []),
          ...(speaker ? [{ id: "participation", label: "Speaker profile", href: href(route + "/participation") }] : []),
        ]}
      />
      {active === "participation" && speaker ? (
        <ParticipantSpeaker data={speaker} eventSlug={event.slug} terms={speakerTerms.terms} reload={loaded.reload} />
      ) : submission && ["submission", "speakers"].includes(active) ? (
        <ParticipantSubmission data={submission} forms={forms} event={event} facet={active} reload={loaded.reload} />
      ) : (
        <Alert>This view is not available for your role.</Alert>
      )}
    </div>
  );
}
