import { useEffect, useRef, useState } from "preact/hooks";
import { sessionVirtualRoomResponseSchema } from "../../../../../../../shared/schemas/event-session-virtual-room";
import { personalAgendaResponseSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import { agendaTimeZones, formatAgendaInstant } from "../../../../../../../shared/agenda-time-display";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Button, ButtonLink } from "../../../../../../ui/Button";
import { PersonalAgendaStatus } from "./PersonalAgendaStatus";
import { ParticipationControls } from "./ParticipationControls";

export function SessionParticipation({
  slug,
  occurrenceId,
  backHref,
  showLocalTime = false,
}: {
  slug: string;
  occurrenceId: string;
  backHref: string;
  showLocalTime?: boolean;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation?occurrenceId=${encodeURIComponent(occurrenceId)}&limit=1`;
  const loaded = useData(() => getJson(endpoint, personalAgendaResponseSchema), [endpoint]);
  const session = loaded.data?.sessions[0];
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
  }, [slug, occurrenceId]);
  async function joinOnline() {
    if (joining) return;
    const generation = joinGeneration.current;
    setJoining(true);
    setJoinError("");
    try {
      const response = await getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/virtual-room`,
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
  const back = <ButtonLink href={backHref}>Back to My agenda</ButtonLink>;
  if (loaded.loading) return <Spinner label="Loading session participation…" />;
  if (!session || session.id !== occurrenceId)
    return (
      <div class="pk-stack">
        <PageHeader title="Session participation" actions={back} />
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
        actions={
          <>
            {session.onlineAccessAvailable && (
              <Button variant="primary" loading={joining} onClick={() => void joinOnline()}>
                Join online
              </Button>
            )}
            {back}
          </>
        }
      />
      {loaded.error && <ErrorAlert error={loaded.error} />}
      {joinError && <ErrorAlert error={joinError} />}
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
