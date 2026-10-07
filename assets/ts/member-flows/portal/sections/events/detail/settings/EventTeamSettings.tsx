import { usePortalHashLocation } from "../../../../hash-location";
import { agendaSnapshotSchema, type AgendaRoleMember } from "../../../../../../../shared/schemas/event-agenda";
import { getJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { Tabs } from "../../../../../../components/Tabs";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { ButtonLink } from "../../../../../../ui/Button";
import { DataTable } from "../../../../../../ui/DataTable";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Team } from "../Team";
import { StaffingSetup } from "../agenda/StaffingSetup";

export function EventTeamSettings({
  slug,
  section,
  personId,
  teamPath,
  staffingPath,
  canManage,
  canEditStaffing,
}: {
  slug: string;
  section?: string;
  personId?: string;
  teamPath: string;
  staffingPath: string;
  canManage: boolean;
  canEditStaffing: boolean;
}) {
  if (section === "access" && !canManage)
    return <ErrorAlert error="Access role management is not available to your current identity." />;
  const active = section === "staffing" ? "staffing" : canManage ? "access" : "staffing";
  return (
    <>
      <Tabs
        label="Team sections"
        items={[
          ...(canManage ? [{ key: "access", label: "Access roles" }] : []),
          ...(canEditStaffing ? [{ key: "staffing", label: "Staffing eligibility" }] : []),
        ]}
        active={active}
        hrefFor={(key) => `${teamPath}/${key}`}
      />
      {active === "access" && canManage ? (
        <Team slug={slug} teamSegment={section === "access" ? personId : section} teamPath={`${teamPath}/access`} />
      ) : canEditStaffing ? (
        <StaffingPeople
          key={slug}
          slug={slug}
          personId={personId}
          basePath={`${teamPath}/staffing`}
          staffingPath={staffingPath}
        />
      ) : (
        <ErrorAlert error="Team settings are not available to your current identity." />
      )}
    </>
  );
}

function StaffingPeople({
  slug,
  personId,
  basePath,
  staffingPath,
}: {
  slug: string;
  personId?: string;
  basePath: string;
  staffingPath: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const agenda = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  if (agenda.loading) return <Spinner label="Loading staffing eligibility…" />;
  if (agenda.error || !agenda.data) return <ErrorAlert error={agenda.error ?? "Agenda unavailable"} />;
  const snapshot = agenda.data;
  if (personId && personId !== "new" && !snapshot.roleMembers.some((person) => person.userId === personId))
    return <ErrorAlert error="Eligible person not found." />;
  return (
    <>
      <ButtonLink href={usePortalHashLocation.hrefs(staffingPath)}>Back to staffing blocks and assignments</ButtonLink>
      {personId ? (
        <StaffingSetup
          key={personId}
          kind="person"
          editId={personId === "new" ? undefined : personId}
          snapshot={snapshot}
          onSaved={() => {
            void agenda.reload();
          }}
          onClose={() => navigate(basePath)}
        />
      ) : (
        <Panel>
          <PanelHeader title="Staffing eligibility">
            <ButtonLink href={usePortalHashLocation.hrefs(`${basePath}/new`)}>Add eligible person</ButtonLink>
          </PanelHeader>
          <PanelBody flush>
            <DataTable<AgendaRoleMember>
              caption="Eligible people"
              rows={snapshot.roleMembers}
              rowKey={(person) => person.userId}
              empty="No eligible people configured."
              rowAction={(person) => ({
                label: `Edit ${person.displayName}`,
                href: usePortalHashLocation.hrefs(`${basePath}/${encodeURIComponent(person.userId)}`),
              })}
              columns={[
                { id: "person", header: "Person", cell: (person) => person.displayName, width: "primary" },
                {
                  id: "duties",
                  header: "Eligible duties",
                  cell: (person) =>
                    person.roles
                      .map((id) => snapshot.staffingRoles.find((role) => role.id === id)?.name ?? id)
                      .join(", "),
                },
                {
                  id: "attendance",
                  header: "Attendance",
                  cell: (person) => (person.attendanceMode === "remote" ? "Remote" : "In person"),
                },
              ]}
            />
          </PanelBody>
        </Panel>
      )}
    </>
  );
}
