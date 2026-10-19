import { agendaSnapshotSchema } from "../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../shared/api-client";
import { useData } from "../../../../hooks/useData";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { SchedulingRules } from "../events/detail/agenda/AgendaSettings";
import { useAgendaTimeStep } from "../events/detail/agenda/useAgendaTimeStep";

export function GroupEventScheduling({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  if (!canEdit) return <ErrorAlert error="Scheduling settings are not available to your current identity." />;
  return <SchedulingSettings key={slug} slug={slug} />;
}

function SchedulingSettings({ slug }: { slug: string }) {
  const { timeStep, setTimeStep } = useAgendaTimeStep(slug);
  const agenda = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  if (agenda.loading) return <Spinner label="Loading scheduling settings…" />;
  if (agenda.error || !agenda.data) return <ErrorAlert error={agenda.error ?? "Agenda unavailable"} />;
  return (
    <SchedulingRules
      snapshot={agenda.data}
      timeStep={timeStep}
      onTimeStepChange={setTimeStep}
      onSaved={() => {
        void agenda.reload();
      }}
    />
  );
}
