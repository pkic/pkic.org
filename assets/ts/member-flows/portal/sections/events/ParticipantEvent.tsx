import { lazy, Suspense } from "preact/compat";
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
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelHeader, PanelBody } from "../../../../ui/Panel";
import { Tabs } from "../../../../ui/Tabs";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { formatDateRange } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";

const MyAgenda = lazy(() => import("./detail/participation/MyAgenda").then((module) => ({ default: module.MyAgenda })));
const MyPromotionKits = lazy(() =>
  import("./detail/agenda/MyPromotionKits").then((module) => ({ default: module.MyPromotionKits })),
);
const MySessionManagement = lazy(() =>
  import("./detail/participation/MySessionManagement").then((module) => ({ default: module.MySessionManagement })),
);
type EventDetail = z.infer<typeof eventDetailResponseSchema>["event"];
type Selection = { kind?: "registration" | "proposal"; resourceId?: string; tab?: string };
const href = usePortalHashLocation.hrefs;

export function ParticipantEventPage({ slug, ...selection }: Selection & { slug: string }) {
  const loaded = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}`, eventDetailResponseSchema),
    [slug],
  );
  if (loaded.loading) return <Spinner label="Loading event…" />;
  if (!loaded.data) return <Alert tone="danger">{loaded.error}</Alert>;
  return <ParticipantEvent event={loaded.data.event} {...selection} />;
}

export function ParticipantEvent({ event, kind, resourceId, tab }: Selection & { event: EventDetail }) {
  const base = `/events/${encodeURIComponent(event.slug)}`;
  const registrationId = event.participation?.registrationId;
  const hasProposals = Boolean(event.participation?.proposals || event.participation?.speakerProposals);
  const active =
    kind === "registration"
      ? "registration"
      : kind === "proposal" || tab === "submissions"
        ? "proposals"
        : tab === "agenda"
          ? "agenda"
          : tab === "promotion"
            ? "promotion"
            : tab === "session-management"
              ? "session-management"
              : "overview";
  const tabs = [
    { id: "overview", label: "Overview", href: href(base) },
    { id: "agenda", label: "My agenda", href: href(base + "/agenda") },
    ...(registrationId
      ? [
          {
            id: "registration",
            label: "Registration",
            href: href(eventParticipantRecordPath(event.slug, "registration", registrationId)),
          },
        ]
      : []),
    ...(hasProposals
      ? [
          {
            id: "proposals",
            label: "Proposals",
            href: href(base + "/submissions"),
          },
          { id: "promotion", label: "Promotion kits", href: href(base + "/promotion") },
          { id: "session-management", label: "My sessions", href: href(base + "/session-management") },
        ]
      : []),
  ];
  const header = (recordTitle?: string) => (
    <>
      <PageHeader
        title={event.name}
        trail={[
          { label: "Events", href: href("/events") },
          { label: event.name, ...(active !== "overview" ? { href: href(base) } : {}) },
          ...(active !== "overview"
            ? [
                {
                  label:
                    active === "registration"
                      ? "Registration"
                      : active === "agenda"
                        ? "My agenda"
                        : active === "promotion"
                          ? "Promotion kits"
                          : active === "session-management"
                            ? "My sessions"
                            : "Proposals",
                  ...(kind === "proposal" ? { href: href(base + "/submissions") } : {}),
                },
              ]
            : []),
          ...(kind === "proposal" ? [{ label: recordTitle ?? "Proposal" }] : []),
        ]}
      />
      <Tabs label="Event" activeId={active} items={tabs} />
    </>
  );
  return (
    <div class="pk-stack">
      {kind !== "proposal" && header()}
      {kind === "registration" && resourceId ? (
        <ParticipantRegistration registrationId={resourceId} eventId={event.id} slug={event.slug} />
      ) : kind === "proposal" && resourceId ? (
        <ParticipantProposal event={event} proposalId={resourceId} facet={tab} header={header} />
      ) : tab === "agenda" ? (
        <Suspense fallback={<Spinner />}>
          <MyAgenda slug={event.slug} />
        </Suspense>
      ) : tab === "session-management" ? (
        <Suspense fallback={<Spinner />}>
          <MySessionManagement slug={event.slug} />
        </Suspense>
      ) : tab === "promotion" ? (
        <Suspense fallback={<Spinner />}>
          <MyPromotionKits slug={event.slug} />
        </Suspense>
      ) : tab === "submissions" ? (
        <ParticipantProposals event={event} />
      ) : (
        <Panel>
          <PanelHeader title="Event details" />
          <PanelBody>
            <div class="pk-stack">
              <DescriptionList
                items={[
                  { term: "When", value: formatDateRange(event.startsAt, event.endsAt, event.timezone) },
                  { term: "Location", value: event.location ?? "Not specified" },
                ]}
              />
              {registrationId && (
                <div class="pk-cluster">
                  <Badge status={event.participation?.registrationStatus ?? "pending"} />
                  <a href={href(eventParticipantRecordPath(event.slug, "registration", registrationId))}>
                    Manage registration
                  </a>
                </div>
              )}
              {hasProposals && <a href={href(base + "/submissions")}>View your proposals and speaker participation</a>}
              {event.basePath && <a href={event.basePath}>Public event information</a>}
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}

function ParticipantProposals({ event }: { event: EventDetail }) {
  return (
    <ApiDataTable
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
      <h2>{submission?.proposal.title ?? speaker?.proposal.title}</h2>
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
