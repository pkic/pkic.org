/**
 * The attendee roster for one group event.
 *
 * One list panel, the way every other collection in the portal is drawn:
 * search, the column filters the API accepts, the rows, the pager. A row is a
 * link to the registration's own page. The attendance manager used to unfold
 * between the rows — a faceted record drawn as an expansion, with the site
 * header sliding over it and no address anyone could share — and the list
 * said "in_person" for a registration whose three days were one confirmed and
 * two waitlisted, and nothing at all about the waitlist.
 */
import { useRef, useState } from "preact/hooks";
import { PersonCell } from "../../../../ui/PersonCell";
import { RowActions } from "../../../../ui/RowActions";
import {
  EVENT_REGISTRATION_STATUSES,
  eventAttendanceRegistrationsListResponseSchema,
  eventRegistrationStatusLabel,
  type EventAttendanceRegistrationsStats,
  type EventAttendanceRegistrationSummary,
} from "../../../../../shared/schemas/event-registrations";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../components/Badge";
import { RegistrationDayStates } from "../../../../components/event-registrations/RegistrationDayStates";
import { RegistrationTotals } from "../../../../components/event-registrations/RegistrationTotals";
import { RegistrationRosterActions } from "../../../../components/event-registrations/RegistrationRosterActions";
import { Button } from "../../../../ui/Button";
import { BulkBar } from "../../../../ui/BulkBar";
import { useCollectionSelection } from "../../../../hooks/useCollectionSelection";
import {
  filteredBadgePrintScope,
  type BadgePrintScope,
} from "../../../../components/event-badges/badge-print-population";
import { ATTENDANCE_TYPES } from "../../../../../shared/schemas/registration";
import { BADGE_DISPLAY_ROLE_LABELS, badgeDisplayRoleSchema } from "../../../../../shared/schemas/participant-roles";
import { attendanceTypeLabel } from "../../../../shared/attendance";
import { usePortalHashLocation } from "../../hash-location";
import { fmtDate, toast } from "../../ui";
import { ContactOrganization } from "../../../../components/ContactOrganization";

/** The registration's address inside its group event. */
export function groupEventRegistrationPath(groupId: string, eventId: string, registrationId: string): string {
  return `/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(registrationId)}`;
}

export function GroupEventRegistrations({
  groupId,
  eventId,
  canManage = false,
  eventSlug,
  badgesPath,
  onPrint,
}: {
  groupId: string;
  eventId: string;
  canManage?: boolean;
  eventSlug?: string;
  badgesPath?: string;
  onPrint?: (scope: BadgePrintScope) => void;
}) {
  const startPrinting = (scope: BadgePrintScope) => onPrint?.(scope);
  const selection = useCollectionSelection<EventAttendanceRegistrationSummary>({
    rowKey: (row) => row.id,
    rowLabel: (row) => row.display_name ?? row.user_email ?? "attendee",
  });
  const [stats, setStats] = useState<EventAttendanceRegistrationsStats | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);
  const registrationEndpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`;

  return (
    <div class="pk-stack pk-stack--snug">
      {stats && <RegistrationTotals stats={stats} />}
      <ApiDataTable
        caption="Registrations"
        urlState="registrations"
        endpoint={registrationEndpoint}
        responseSchema={eventAttendanceRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        onData={(response) => {
          setStats(response.stats);
          selection.onRows(response.registrations);
        }}
        onQueryChange={selection.onQueryChange}
        selection={canManage && eventSlug && onPrint ? selection.selection : undefined}
        bulkBar={
          canManage && eventSlug && onPrint ? (
            <BulkBar count={selection.selected.size} total={selection.total} onClear={selection.clear}>
              <Button
                onClick={() => startPrinting({ kind: "selected", rows: selection.selectedRows })}
                disabled={selection.selectedRows.some((row) => row.status !== "registered")}
              >
                Create / print selected badges
              </Button>
            </BulkBar>
          ) : undefined
        }
        actionsRef={tableRef}
        toolbar={
          canManage
            ? (_actions, query) => (
                <RegistrationRosterActions
                  promotionsEndpoint={`${registrationEndpoint}/promotions`}
                  exportsEndpoint={`${registrationEndpoint}/exports`}
                  onPromoted={() => tableRef.current?.reload()}
                  notify={toast}
                  onPrintAllMatching={
                    eventSlug && onPrint
                      ? () => startPrinting(filteredBadgePrintScope(`${registrationEndpoint}/badges/population`, query))
                      : undefined
                  }
                />
              )
            : undefined
        }
        paginate
        searchPlaceholder="name or email"
        initialSort="-created_at"
        columns={[
          {
            header: "Attendee",
            cell: (registration) => (
              <PersonCell
                name={registration.display_name ?? registration.user_email ?? "—"}
                avatarSrc={registration.headshot_url ?? undefined}
                size="sm"
              />
            ),
            width: "primary",
            sort: { asc: "display_name", desc: "-display_name" },
            // The role band each attendee's badge prints, so a print run can
            // take one role at a time. It narrows the attendees themselves,
            // so it is offered from their column.
            ...(canManage && badgesPath
              ? {
                  filter: {
                    param: "badge_role",
                    options: [
                      { value: "", label: "All badge roles" },
                      ...badgeDisplayRoleSchema.options.map((role) => ({
                        value: role,
                        label: BADGE_DISPLAY_ROLE_LABELS[role],
                      })),
                    ],
                  },
                }
              : {}),
          },
          {
            header: "Organization",
            cell: (r) => (
              <ContactOrganization
                organization={r.organization_name}
                personalEmail={r.personal_email}
                handledLast={r.waitlist_handled_last}
                audience="organizer"
              />
            ),
            className: "pk-small",
          },
          { header: "Job title", cell: (r) => r.job_title ?? "—", className: "pk-small", defaultHidden: true },
          {
            header: "Status",
            cell: (registration) => <Badge status={registration.status} />,
            width: "fit",
            sort: { asc: "status", desc: "-status" },
            filter: {
              param: "status",
              options: [
                { value: "", label: "All statuses" },
                ...EVENT_REGISTRATION_STATUSES.map((status) => ({
                  value: status as string,
                  label: eventRegistrationStatusLabel(status),
                })),
              ],
            },
          },
          {
            // Day by day, because the whole-registration type hides exactly
            // what a manager is looking for. The filter narrows to the rows
            // still waiting for a seat on any day.
            header: "Attendance",
            cell: (registration) => (
              <RegistrationDayStates days={registration.days} attendanceType={registration.attendance_type} />
            ),
            filter: {
              param: "waitlisted",
              options: [
                { value: "", label: "All attendance" },
                { value: "true", label: "On a day waitlist" },
                { value: "false", label: "Not waitlisted" },
              ],
            },
          },
          {
            // The whole-registration type: in-person when any day is. The
            // Attendance column already shows it day by day, so it is hidden
            // until asked for; it stays as a column because its filter is how
            // a badge print run is scoped to one type.
            header: "Attendance type",
            cell: (registration) => attendanceTypeLabel(registration.attendance_type),
            width: "fit",
            className: "pk-small",
            defaultHidden: true,
            sort: { asc: "attendance_type", desc: "-attendance_type" },
            filter: {
              param: "attendance_type",
              options: [
                { value: "", label: "All types" },
                ...ATTENDANCE_TYPES.map((type) => ({ value: type as string, label: attendanceTypeLabel(type) })),
              ],
            },
          },
          {
            header: "Registered",
            cell: (registration) => fmtDate(registration.created_at),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
          ...(canManage && badgesPath
            ? [
                {
                  // The row's commands sit behind its `…`, so a link that
                  // read the same on every row no longer takes a column.
                  header: "",
                  width: "fit" as const,
                  cell: (registration: EventAttendanceRegistrationSummary) => (
                    <RowActions
                      subject={registration.display_name ?? registration.user_email ?? "this attendee"}
                      actions={[
                        {
                          id: "badges",
                          label: "Manage badges",
                          href: usePortalHashLocation.hrefs(
                            `${badgesPath}?userId=${encodeURIComponent(registration.user_id)}`,
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]
            : []),
        ]}
        empty="No registrations for this event."
        rowKey={(registration) => registration.id}
        rowAction={(registration) => ({
          label: `Open registration for ${registration.display_name ?? registration.user_email ?? "this attendee"}`,
          href: usePortalHashLocation.hrefs(groupEventRegistrationPath(groupId, eventId, registration.id)),
        })}
      />
    </div>
  );
}
