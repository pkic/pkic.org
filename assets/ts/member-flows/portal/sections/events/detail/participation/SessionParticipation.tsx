import { personalAgendaResponseSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import { agendaTimeZones, formatAgendaInstant } from "../../../../../../../shared/agenda-time-display";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { ButtonLink } from "../../../../../../ui/Button";
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
      <PageHeader title={session.title} eyebrow="Session participation" actions={back} />
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
