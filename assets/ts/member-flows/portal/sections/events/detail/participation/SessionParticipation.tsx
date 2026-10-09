import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { sessionVirtualRoomResponseSchema } from "../../../../../../../shared/schemas/event-session-virtual-room";
import {
  personalAgendaResponseSchema,
  type personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import { agendaTimeZones, formatAgendaInstant } from "../../../../../../../shared/agenda-time-display";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Alert } from "../../../../../../ui/Alert";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { PersonalAgendaStatus } from "./PersonalAgendaStatus";
import { ParticipationControls } from "./ParticipationControls";
import { availableScannerActions } from "../../../../../../../shared/event-scanner-permissions";
import { hasEventAgendaPermission } from "../../event-agenda-access";
import { usePortalHashLocation } from "../../../../hash-location";

type Session = z.infer<typeof personalAgendaSessionSchema>;

/** One occurrence's live personal participation, read from the canonical personal agenda. */
function useParticipationSession(slug: string, occurrenceId: string, refreshKey?: string) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation?occurrenceId=${encodeURIComponent(occurrenceId)}&limit=1`;
  return useData(() => getJson(endpoint, personalAgendaResponseSchema), [endpoint, refreshKey]);
}

/** Join and check-in actions shared by the session dialog and the dedicated session view. */
function SessionParticipationActions({
  slug,
  eventId,
  session,
  variant,
}: {
  slug: string;
  eventId?: string;
  session: Session;
  variant?: "primary";
}) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const joinGeneration = useRef(0);
  useEffect(() => {
    joinGeneration.current += 1;
    setJoining(false);
    setJoinError("");
    return () => {
      joinGeneration.current += 1;
    };
  }, [slug, session.id]);
  async function joinOnline() {
    if (joining) return;
    const generation = joinGeneration.current;
    setJoining(true);
    setJoinError("");
    try {
      const response = await getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(session.id)}/virtual-room`,
        sessionVirtualRoomResponseSchema,
      );
      if (generation === joinGeneration.current) window.location.assign(response.url);
    } catch (error) {
      if (generation === joinGeneration.current)
        setJoinError(error instanceof Error ? error.message : "The online session is unavailable. Please try again.");
    } finally {
      if (generation === joinGeneration.current) setJoining(false);
    }
  }
  const checkIn =
    eventId && availableScannerActions((permission) => hasEventAgendaPermission(eventId, permission)).length > 0;
  return (
    <>
      {checkIn && (
        <ButtonLink
          href={usePortalHashLocation.hrefs(
            `/events/${encodeURIComponent(slug)}/scanner?${new URLSearchParams({ session: session.id }).toString()}`,
          )}
        >
          Start session check-in
        </ButtonLink>
      )}
      {session.onlineAccessAvailable && (
        <Button variant={variant} loading={joining} onClick={() => void joinOnline()}>
          Join online
        </Button>
      )}
      {joinError && <ErrorAlert error={joinError} />}
    </>
  );
}

/** Live registration management inside the shared agenda's session details. */
export function SessionParticipationManager({
  slug,
  eventId,
  occurrenceId,
  refreshKey,
  notice,
  onChanged,
}: {
  slug: string;
  eventId?: string;
  occurrenceId: string;
  /** Changes when the viewer's marks change elsewhere, so this view rereads its row. */
  refreshKey?: string;
  /** Shown above the controls, for example when the approved session changed while it was open. */
  notice?: string;
  onChanged: (session: Session) => void;
}) {
  const loaded = useParticipationSession(slug, occurrenceId, refreshKey);
  const session = loaded.data?.sessions[0];
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (session?.id === occurrenceId) changed.current(session);
  }, [session, occurrenceId]);
  return (
    <section class="pk-stack pk-stack--snug" aria-label="My participation">
      <h3>My participation</h3>
      {loaded.loading ? (
        <Spinner label="Loading your participation…" />
      ) : !session || session.id !== occurrenceId ? (
        <ErrorAlert error={loaded.error ?? "This session is no longer available in the published agenda."} />
      ) : (
        <>
          {loaded.error && <ErrorAlert error={loaded.error} />}
          {notice && <Alert tone="warn">{notice}</Alert>}
          <div class="pk-cluster">
            <SessionParticipationActions slug={slug} eventId={eventId} session={session} variant="primary" />
          </div>
          <PersonalAgendaStatus session={session} />
          <ParticipationControls
            slug={slug}
            session={session}
            preference={false}
            onSaved={() => {
              void loaded.reload();
            }}
          />
        </>
      )}
    </section>
  );
}

/**
 * Dedicated view for an occurrence that is not on the shared public agenda, such as an invitation-only session.
 * It renders inside the participant event tabs, so the My agenda tab is the way back.
 */
export function SessionParticipation({
  slug,
  eventId,
  occurrenceId,
  showLocalTime = false,
}: {
  slug: string;
  eventId?: string;
  occurrenceId: string;
  showLocalTime?: boolean;
}) {
  const loaded = useParticipationSession(slug, occurrenceId);
  const session = loaded.data?.sessions[0];
  if (loaded.loading) return <Spinner label="Loading session participation…" />;
  if (!session || session.id !== occurrenceId)
    return (
      <div class="pk-stack">
        <PageHeader title="Session participation" />
        <ErrorAlert error={loaded.error ?? "This session is no longer available in the published agenda."} />
      </div>
    );
  const zones = agendaTimeZones(
    session.timeZone,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    session.attendanceMode,
    showLocalTime,
  );
  const timeValue = (value: string | null) =>
    value ? (
      <span class="pk-stack pk-stack--tight">
        <span>
          {zones.primary.label} · {formatAgendaInstant(value, zones.primary.zone)}
        </span>
        {zones.secondary && (
          <small class="pk-muted">
            {zones.secondary.label} · {formatAgendaInstant(value, zones.secondary.zone)}
          </small>
        )}
      </span>
    ) : (
      "Time to be announced"
    );
  return (
    <div class="pk-stack">
      <PageHeader
        title={session.title}
        eyebrow="Session participation"
        actions={<SessionParticipationActions slug={slug} eventId={eventId} session={session} variant="primary" />}
      />
      {loaded.error && <ErrorAlert error={loaded.error} />}
      <DescriptionList
        items={[
          {
            term: "Starts",
            value: timeValue(session.startAt),
          },
          {
            term: "Ends",
            value: timeValue(session.endAt),
          },
          { term: "Locations", value: session.rooms.map((room) => room.name).join(", ") || "No physical location" },
          { term: "My agenda", value: <PersonalAgendaStatus session={session} /> },
        ]}
      />
      <Panel aria-label="Manage participation">
        <PanelHeader title="Manage participation" />
        <PanelBody>
          <ParticipationControls
            slug={slug}
            session={session}
            onSaved={() => {
              void loaded.reload();
            }}
          />
        </PanelBody>
      </Panel>
    </div>
  );
}
