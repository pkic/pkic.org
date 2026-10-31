import { useState } from "preact/hooks";
import { eventTeamRosterResponseSchema } from "../../../../../../../shared/schemas/event-team";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import { getJson, deleteJson } from "../../../../../../shared/api-client";
import { useData } from "../../../../../../hooks/useData";
import { Spinner } from "../../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { personDisplayName } from "../../../../../../../shared/person-display";
import { PersonCell } from "../../../../../../ui/PersonCell";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Menu } from "../../../../../../ui/Menu";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { formatNumber } from "../../../../../../../shared/format-number";
import { fmt } from "../../../../ui";
import { performAction } from "../../../../actions";
import { usePortalHashLocation } from "../../../../hash-location";
import { AddTeamMemberPage, ROLE_LABELS } from "../Team";
import { TeamStaffingEditor } from "./TeamStaffingEditor";

export function TeamPerson({
  slug,
  userId,
  operation,
  teamPath,
  timeZone,
  canManage,
  canEditStaffing,
  canReadStaffing,
}: {
  slug: string;
  userId: string;
  operation?: string;
  teamPath: string;
  timeZone: string;
  canManage: boolean;
  canEditStaffing: boolean;
  canReadStaffing: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const person = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/team?userId=${encodeURIComponent(userId)}`,
        eventTeamRosterResponseSchema,
      ),
    [slug, userId],
  );
  if (person.loading) return <Spinner label="Loading team member…" />;
  if (person.error) return <ErrorAlert error={person.error} />;
  const row = person.data?.people[0];
  if (!row) return <ErrorAlert error="Team member not found." />;
  const name = personDisplayName(row, null);
  if (operation === "edit")
    return canEditStaffing ? (
      <TeamStaffingEditor slug={slug} userId={userId} teamPath={teamPath} person={row} />
    ) : (
      <ErrorAlert error="Editing scheduling duties is not available to your current identity." />
    );
  if (operation === "access")
    return canManage ? (
      <AddTeamMemberPage
        slug={slug}
        teamPath={`${teamPath}/${userId}`}
        timeZone={timeZone}
        person={{ id: userId, firstName: row.firstName ?? undefined, lastName: row.lastName ?? undefined, email: "" }}
      />
    ) : (
      <ErrorAlert error="Granting event access is not available to your current identity." />
    );
  if (operation) return <ErrorAlert error="Team view not found." />;
  async function revoke(id: string, label: string) {
    if (
      !(await confirmAction({
        title: `Revoke ${label} access from ${name}?`,
        consequences: [`${name} loses ${label.toLowerCase()} access to this event.`],
        confirmLabel: "Revoke access",
      }))
    )
      return;
    await performAction({
      setBusy,
      request: () => deleteJson(`/api/v1/events/${encodeURIComponent(slug)}/roles/${id}`, successResponseSchema),
      successMessage: "Event access revoked",
      afterSuccess: () => person.reload(),
    });
  }
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title={name} breadcrumb />
        <PanelBody>
          <PersonCell name={name} avatarSrc={row.headshotUrl} size="sm" />
        </PanelBody>
      </Panel>
      {canManage && (
        <Panel>
          <PanelHeader
            title="Event access"
            menu={
              <Menu
                label={`Event access actions for ${name}`}
                align="end"
                items={[
                  {
                    id: "grant",
                    label: "Grant event access",
                    href: usePortalHashLocation.hrefs(`${teamPath}/${userId}/access`),
                  },
                  ...row.accessRoles.map((role) => ({
                    id: role.id,
                    label: `Revoke ${ROLE_LABELS[role.role]} access`,
                    danger: true,
                    disabled: busy,
                    onSelect: () => void revoke(role.id, ROLE_LABELS[role.role]),
                  })),
                ]}
              />
            }
          />
          <PanelBody>
            <DescriptionList
              items={
                row.accessRoles.length
                  ? row.accessRoles.map((role) => ({
                      term: ROLE_LABELS[role.role],
                      value: role.expiresAt ? `Expires ${fmt(role.expiresAt)}` : "No expiry",
                    }))
                  : [{ term: "Access", value: "No event access granted" }]
              }
            />
          </PanelBody>
        </Panel>
      )}
      {canReadStaffing && (
        <Panel>
          <PanelHeader
            title="Scheduling duties"
            menu={
              canEditStaffing ? (
                <Menu
                  label={`Scheduling actions for ${name}`}
                  align="end"
                  items={[
                    {
                      id: "edit",
                      label: "Edit scheduling duties",
                      href: usePortalHashLocation.hrefs(`${teamPath}/${userId}/edit`),
                    },
                  ]}
                />
              ) : undefined
            }
          />
          <PanelBody>
            <DescriptionList
              items={[
                { term: "Duties", value: row.duties.join(", ") || "No duties configured" },
                ...(row.staffing
                  ? [
                      { term: "Attendance", value: row.staffing.attendanceMode === "remote" ? "Remote" : "In person" },
                      { term: "Experience", value: row.staffing.seniority === "senior" ? "Senior" : "Junior" },
                      {
                        term: "Available from",
                        value: row.staffing.availableFrom ? fmt(row.staffing.availableFrom) : "No limit",
                      },
                      {
                        term: "Available until",
                        value: row.staffing.availableUntil ? fmt(row.staffing.availableUntil) : "No limit",
                      },
                      {
                        term: "Maximum duty time",
                        value: row.staffing.maxMinutes
                          ? `${formatNumber(row.staffing.maxMinutes)} minutes`
                          : "No limit",
                      },
                    ]
                  : []),
              ]}
            />
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
