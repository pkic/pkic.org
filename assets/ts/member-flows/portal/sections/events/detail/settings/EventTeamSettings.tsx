import { usePortalHashLocation } from "../../../../hash-location";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { personDisplayName } from "../../../../../../../shared/person-display";
import { PersonCell } from "../../../../../../ui/PersonCell";
import { EmptyState } from "../../../../../../ui/EmptyState";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { eventTeamRosterResponseSchema, type EventTeamPerson } from "../../../../../../../shared/schemas/event-team";
import { ROLE_LABELS, AddTeamMemberPage } from "../Team";
import { TeamPerson } from "./TeamPerson";
import { TeamStaffingEditor } from "./TeamStaffingEditor";

export function EventTeamSettings({
  slug,
  section,
  personId,
  teamPath,
  timeZone,
  canManage,
  canEditStaffing,
  canReadStaffing = canEditStaffing,
}: {
  slug: string;
  section?: string;
  personId?: string;
  teamPath: string;
  timeZone: string;
  canManage: boolean;
  canEditStaffing: boolean;
  canReadStaffing?: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  if (section === "new")
    return canEditStaffing ? (
      <TeamStaffingEditor slug={slug} teamPath={teamPath} />
    ) : canManage ? (
      <AddTeamMemberPage slug={slug} teamPath={teamPath} timeZone={timeZone} />
    ) : (
      <ErrorAlert error="Adding team members is not available to your current identity." />
    );
  if (section)
    return (
      <TeamPerson
        slug={slug}
        userId={section}
        operation={personId}
        teamPath={teamPath}
        timeZone={timeZone}
        canManage={canManage}
        canEditStaffing={canEditStaffing}
        canReadStaffing={canReadStaffing}
      />
    );
  return (
    <ApiDataTable
      urlState="event-team"
      toolbarClass="pk-toolbar-row"
      compactToolbarActions={[]}
      compactToolbarLabel="Team filters and actions"
      caption="Event team"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/team`}
      responseSchema={eventTeamRosterResponseSchema}
      resolve={(data) => data.people}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search people…"
      createAction={
        canManage || canEditStaffing
          ? { label: "Add team member", onSelect: () => navigate(`${teamPath}/new`) }
          : undefined
      }
      columns={[
        {
          header: "Person",
          width: "primary",
          sort: { asc: "person", desc: "-person" },
          cell: (person) => (
            <PersonCell name={personDisplayName(person, null)} avatarSrc={person.headshotUrl} size="sm" />
          ),
        },
        ...(canManage
          ? [
              {
                header: "Event access",
                cell: (person: EventTeamPerson) =>
                  person.accessRoles.map((role) => ROLE_LABELS[role.role]).join(", ") || "No event access",
              },
            ]
          : []),
        ...(canReadStaffing
          ? [
              {
                header: "Scheduling duties",
                cell: (person: EventTeamPerson) => person.duties.join(", ") || "No duties configured",
              },
            ]
          : []),
      ]}
      rowKey={(person) => person.userId}
      rowAction={(person) => ({
        label: `Open ${personDisplayName(person, null)}`,
        href: usePortalHashLocation.hrefs(`${teamPath}/${encodeURIComponent(person.userId)}`),
      })}
      empty={<EmptyState title="No team members yet" body="Add people to configure their event duties or access." />}
    />
  );
}
