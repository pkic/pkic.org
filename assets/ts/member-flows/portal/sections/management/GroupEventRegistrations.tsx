import { RegistrationSinceDialog } from "../../../../components/event-registrations/RegistrationSinceDialog";
import { registrationRosterExportUrl } from "../../../../components/event-registrations/registration-roster-export";
import {
  RegistrationOutputActions,
  registrationOutputMenuItems,
} from "../../../../components/event-registrations/RegistrationOutputActions";
import type { BadgePrintAction } from "../../../../../shared/schemas/event-badge-printing";
import { countryName, countryOptions, isCountryCode } from "../../../../../shared/countries";
import { IconCheckmark } from "../../../../ui/MediaIcons";
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
import { registrationPersonColumn } from "../../../../components/event-registrations/registration-person-column";
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
import { registrationAttendanceColumns } from "../../../../components/event-registrations/registration-attendance-columns";
import { RegistrationTotals } from "../../../../components/event-registrations/RegistrationTotals";
import { RegistrationRosterActions } from "../../../../components/event-registrations/RegistrationRosterActions";
import { BulkBar } from "../../../../ui/BulkBar";
import { useCollectionSelection } from "../../../../hooks/useCollectionSelection";
import {
  filteredBadgePrintScope,
  type BadgePrintScope,
} from "../../../../components/event-badges/badge-print-population";
import { groupEventDaysResponseSchema } from "../../../../../shared/schemas/group-events";
import { getJson } from "../../../../shared/api-client";
import { useData } from "../../../../hooks/useData";
import { BADGE_DISPLAY_ROLE_LABELS, badgeDisplayRoleSchema } from "../../../../../shared/schemas/participant-roles";
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
  onPrint?: (scope: BadgePrintScope, action?: BadgePrintAction) => void;
}) {
  const startPrinting = (scope: BadgePrintScope, action: BadgePrintAction = "preview") => onPrint?.(scope, action);
  const selection = useCollectionSelection<EventAttendanceRegistrationSummary>({
    rowKey: (row) => row.id,
    rowLabel: (row) => row.display_name ?? row.user_email ?? "attendee",
  });
  const [sinceOpen, setSinceOpen] = useState(false);
  const [query, setQuery] = useState<Readonly<Record<string, string>>>({});
  const [stats, setStats] = useState<EventAttendanceRegistrationsStats | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);
  // The types a registration can hold are the ones this event configures per day.
  const days = useData(
    () =>
      getJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/days`,
        groupEventDaysResponseSchema,
      ),
    [groupId, eventId],
  );
  const registrationEndpoint = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}/registrations`;
  const selectedExportUrl = registrationRosterExportUrl(
    `${registrationEndpoint}/exports`,
    query,
    selection.selectedRows.map((row) => row.id),
  );

  return (
    <div class="pk-stack pk-stack--snug">
      {stats && <RegistrationTotals stats={stats} />}
      <ApiDataTable
        caption="Registrations"
        tableOptionsFilters
        urlState="registrations"
        endpoint={registrationEndpoint}
        responseSchema={eventAttendanceRegistrationsListResponseSchema}
        resolve={(response) => response.registrations}
        resolvePage={(response) => response.page}
        onData={(response) => {
          setStats(response.stats);
          selection.onRows(response.registrations);
        }}
        onQueryChange={(next) => {
          selection.onQueryChange();
          setQuery(next);
        }}
        selection={canManage ? selection.selection : undefined}
        bulkBar={
          canManage ? (
            <BulkBar count={selection.selected.size} total={selection.total} onClear={selection.clear}>
              <RegistrationOutputActions
                scope="selected"
                onPrint={
                  eventSlug && onPrint
                    ? (action) => startPrinting({ kind: "selected", rows: selection.selectedRows }, action)
                    : undefined
                }
                attendeeUrl={selectedExportUrl}
                sponsorUrl={registrationRosterExportUrl(
                  `${registrationEndpoint}/exports`,
                  { ...query, audience: "sponsor" },
                  selection.selectedRows.map((row) => row.id),
                )}
              />
            </BulkBar>
          ) : undefined
        }
        actionsRef={tableRef}
        toolbar={
          canManage
            ? (_actions, query) => (
                <RegistrationRosterActions
                  promotionsEndpoint={`${registrationEndpoint}/promotions`}
                  exportsEndpoint={registrationRosterExportUrl(`${registrationEndpoint}/exports`, query)}
                  sponsorExportUrl={registrationRosterExportUrl(`${registrationEndpoint}/exports`, {
                    ...query,
                    audience: "sponsor",
                  })}
                  onPromoted={() => tableRef.current?.reload()}
                  notify={toast}
                  onPrintAllMatching={
                    eventSlug && onPrint
                      ? (action) =>
                          startPrinting(
                            filteredBadgePrintScope(`${registrationEndpoint}/badges/population`, query),
                            action,
                          )
                      : undefined
                  }
                />
              )
            : undefined
        }
        paginate
        searchPlaceholder="name, email, or organization"
        initialSort="-created_at"
        columns={[
          registrationPersonColumn<EventAttendanceRegistrationSummary>(),
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
          {
            header: "Job title",
            cell: (r) => r.job_title ?? "—",
            className: "pk-small",
            defaultHidden: true,
            filter: { param: "job_title", text: { placeholder: "e.g. security architect" } },
          },
          {
            header: "Country",
            cell: (r) => (r.country ? (isCountryCode(r.country) ? countryName(r.country) : r.country) : "—"),
            defaultHidden: true,
            filter: { param: "country", options: [{ value: "", label: "All countries" }, ...countryOptions()] },
          },
          {
            header: "Attendee type",
            cell: (r) => BADGE_DISPLAY_ROLE_LABELS[r.badge_role],
            defaultHidden: true,
            filter: {
              param: "badge_role",
              options: [
                { value: "", label: "All attendee types" },
                ...badgeDisplayRoleSchema.options.map((value) => ({ value, label: BADGE_DISPLAY_ROLE_LABELS[value] })),
              ],
            },
          },
          {
            header: "Consent",
            width: "fit",
            cell: (r) => (
              <span
                title={r.sponsor_consent ? "Consented to sponsor sharing" : "No sponsor sharing consent"}
                aria-label={r.sponsor_consent ? "Consented to sponsor sharing" : "No sponsor sharing consent"}
              >
                {r.sponsor_consent ? <IconCheckmark aria-hidden="true" /> : "—"}
              </span>
            ),
            filter: {
              param: "consent",
              label: "Sponsor consent",
              options: [
                { value: "", label: "Any sponsor consent" },
                { value: "true", label: "Consented" },
                { value: "false", label: "Not consented" },
              ],
            },
          },
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
          ...registrationAttendanceColumns<EventAttendanceRegistrationSummary>(days.data?.days ?? [], query),
          {
            header: "Registered",
            cell: (registration) => fmtDate(registration.created_at),
            width: "fit",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
            filter: {
              param: "created_since",
              options: [
                { value: "", label: "All dates" },
                ...(query.created_since
                  ? [{ value: query.created_since, label: `Since ${fmtDate(query.created_since)}` }]
                  : []),
              ],
              optionNavigation: [
                { id: "registered-since", label: "Choose start date…", onSelect: () => setSinceOpen(true) },
              ],
            },
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
                        ...registrationOutputMenuItems({
                          onPrint: onPrint
                            ? (action) => startPrinting({ kind: "selected", rows: [registration] }, action)
                            : undefined,
                          attendeeUrl: registrationRosterExportUrl(`${registrationEndpoint}/exports`, query, [
                            registration.id,
                          ]),
                          sponsorUrl: registrationRosterExportUrl(
                            `${registrationEndpoint}/exports`,
                            { ...query, audience: "sponsor" },
                            [registration.id],
                          ),
                        }),
                        {
                          id: "badges",
                          label: "View badges",
                          separatorBefore: true,
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
      {sinceOpen && (
        <RegistrationSinceDialog
          value={query.created_since}
          onApply={(value) => tableRef.current?.setFilter?.("created_since", value)}
          onClose={() => setSinceOpen(false)}
        />
      )}
    </div>
  );
}
