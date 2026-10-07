import { agendaSnapshotSchema } from "../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../shared/api-client";
import { useData } from "../../../../hooks/useData";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { usePortalHashLocation } from "../../hash-location";
import { AgendaSettings } from "../events/detail/agenda/AgendaSettings";
import { useAgendaTimeStep } from "../events/detail/agenda/useAgendaTimeStep";

export function GroupEventScheduling({
  slug,
  canEdit,
  backPath,
}: {
  slug: string;
  canEdit: boolean;
  backPath: string;
}) {
  if (!canEdit) return <ErrorAlert error="Scheduling settings are not available to your current identity." />;
  return <SchedulingSettings key={slug} slug={slug} backPath={backPath} />;
}

function SchedulingSettings({ slug, backPath }: { slug: string; backPath: string }) {
  const [, navigate] = usePortalHashLocation();
  const { timeStep, setTimeStep } = useAgendaTimeStep(slug);
  const agenda = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  if (agenda.loading) return <Spinner label="Loading scheduling settings…" />;
  if (agenda.error || !agenda.data) return <ErrorAlert error={agenda.error ?? "Agenda unavailable"} />;
  return (
    <AgendaSettings
      snapshot={agenda.data}
      timeStep={timeStep}
      onTimeStepChange={setTimeStep}
      onSaved={() => {
        void agenda.reload();
      }}
      onClose={() => navigate(backPath)}
    />
  );
}
