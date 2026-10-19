import type { EventTeamPerson } from "../../../../../../../shared/schemas/event-team";
import { agendaSnapshotSchema } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { usePortalHashLocation } from "../../../../hash-location";
import { StaffingSetup } from "../agenda/StaffingSetup";
export function TeamStaffingEditor({
  slug,
  userId,
  teamPath,
  person,
}: {
  slug: string;
  userId?: string;
  teamPath: string;
  person?: EventTeamPerson;
}) {
  const [, navigate] = usePortalHashLocation();
  const agenda = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  if (agenda.loading) return <Spinner label="Loading scheduling duties…" />;
  if (agenda.error || !agenda.data) return <ErrorAlert error={agenda.error ?? "Agenda unavailable"} />;
  return (
    <StaffingSetup
      kind="person"
      editId={userId}
      initialPerson={
        person
          ? {
              id: person.userId,
              email: "",
              firstName: person.firstName ?? undefined,
              lastName: person.lastName ?? undefined,
            }
          : undefined
      }
      snapshot={agenda.data}
      onSaved={() => void agenda.reload()}
      onClose={() => navigate(userId ? `${teamPath}/${encodeURIComponent(userId)}` : teamPath)}
    />
  );
}
