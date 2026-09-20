import { useState, useRef } from "preact/hooks";
import { usePortalHashLocation } from "../../../hash-location";
import { Badge } from "../../../../../components/Badge";
import type { Column } from "../../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { FilterSelect } from "../../../../../components/FilterSelect";
import { Tabs } from "../../../../../components/Tabs";
import { PersonCell } from "../../../../../ui/PersonCell";
import { attendanceTypeLabel } from "../../../../../shared/attendance";
import { fmt, fmtDate, toast } from "../../../ui";
import type { Registration, RegistrationAttendanceChange } from "../types";
import { EventEmailCampaign } from "../../../../../components/events/EventEmailCampaign";
import { RegistrationDayStates } from "../../../../../components/event-registrations/RegistrationDayStates";
import { RegistrationTotals } from "../../../../../components/event-registrations/RegistrationTotals";
import { RegistrationRosterActions } from "../../../../../components/event-registrations/RegistrationRosterActions";
import { EventFormResponses } from "./Forms";
import {
  EVENT_REGISTRATION_ATTENDANCE_CHANGE_LABELS,
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationAttendanceChangeFilterSchema,
  eventRegistrationStatusLabel,
  eventRegistrationsListResponseSchema,
  type EventRegistrationsListResponse,
} from "../../../../../../shared/schemas/event-registrations";
import {
  eventRegistrationExportsPath,
  eventRegistrationPromotionsPath,
  eventRegistrationsPath,
  eventRegistrationViewPath,
} from "./registration-paths";
// `pk-mono` is defined in Content.css, which ships in a lazy chunk, so the
// module that writes the class name has to import the stylesheet itself.
import "../../../../../ui/Content.css";

const ATTENDANCE_CHANGE_PRESETS: Record<string, string> = {
  "attendance-changed": "any",
  "left-in-person": "left_in_person",
  "joined-in-person": "joined_in_person",
};

function attendanceJourneyLabel(history: RegistrationAttendanceChange[]): string {
  const transitions = history.flatMap((change) => change.transitions);
  if (transitions.length === 0) return "No recorded journey";
  if (history.some((change) => change.transitions.length !== 1)) {
    return `${history.length} attendance updates`;
  }

  const path = [transitions[0].fromType, transitions[0].toType];
  for (const transition of transitions.slice(1)) {
    if (path.at(-1) !== transition.fromType) {
      return `${history.length} attendance updates`;
    }
    path.push(transition.toType);
  }
  return path.map(attendanceTypeLabel).join(" → ");
}

type RegistrationStats = EventRegistrationsListResponse["stats"];

// ─── Registration list ────────────────────────────────────────────────────────

function RegistrationsList({ slug, initialAttendanceChange = "" }: { slug: string; initialAttendanceChange?: string }) {
  // Not a column filter: the attendance-change view is seeded by the route
  // (`…/registrations/left-in-person`), reshapes the columns and the empty
  // sentence, and the table does not report its filters back to the page.
  const [attendanceChangeFilter, setAttendanceChangeFilter] = useState(initialAttendanceChange);
  const [stats, setStats] = useState<RegistrationStats | null>(null);
  const tableRef = useRef<ApiTableActions | null>(null);

  const columns: Array<Column<Registration>> = [
    {
      // The same face-then-name cell every roster uses (#90).
      header: "Attendee",
      cell: (r) => (
        <PersonCell
          name={r.display_name ?? r.user_email ?? "—"}
          email={r.display_name && r.user_email ? r.user_email : undefined}
          avatarSrc={r.headshot_url ?? undefined}
          size="sm"
        />
      ),
      width: "primary",
      sort: { asc: "display_name", desc: "-display_name" },
    },
    // Who they represent and what they do, as the account states it (#119).
    // The title is there for the reader who wants it, hidden by default so
    // the row keeps its width for the days.
    { header: "Organization", cell: (r) => r.organization_name ?? "—", className: "pk-small" },
    { header: "Job title", cell: (r) => r.job_title ?? "—", className: "pk-small", defaultHidden: true },
    {
      header: "Status",
      cell: (r) => <Badge status={r.status} />,
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
      // Whether the confirmation mail reached the attendee. The bounce used
      // to be a second badge inside the Status cell while its filter sat in
      // the toolbar; the value and the filter that narrows by it now share
      // one column.
      header: "Email",
      cell: (r) =>
        r.has_bounced ? (
          <Badge status="bounced" />
        ) : (
          <>
            <span class="pk-muted" aria-hidden="true">
              —
            </span>
            <span class="pk-sr-only">Not bounced</span>
          </>
        ),
      width: "fit",
      filter: {
        param: "bounced",
        options: [
          { value: "", label: "All email statuses" },
          { value: "true", label: "Bounced" },
          { value: "false", label: "Not bounced" },
        ],
      },
    },
    {
      // Day by day: the whole-registration type is a derivation that reads a
      // registration with one confirmed and two waitlisted days as plainly
      // "in-person". The filter narrows to those still waiting for a seat.
      header: "Attendance",
      cell: (r) => <RegistrationDayStates days={r.days} attendanceType={r.attendance_type} />,
      sort: { asc: "attendance_type", desc: "-attendance_type" },
      filter: {
        param: "waitlisted",
        options: [
          { value: "", label: "All attendance" },
          { value: "true", label: "On a day waitlist" },
          { value: "false", label: "Not waitlisted" },
        ],
      },
    },
    ...(attendanceChangeFilter
      ? [
          {
            header: "Attendance journey · latest ↓",
            cell: (r: Registration) => {
              const history = r.attendanceChangeHistory ?? [];
              const latest = r.lastAttendanceChange;
              return latest ? (
                <div class="pk-stack pk-stack--tight pk-small">
                  <div class="pk-strong">{attendanceJourneyLabel(history)}</div>
                  <div class="pk-muted pk-mono">Last changed {fmt(latest.changedAt)}</div>
                  {history.length > 1 && (
                    <details onClick={(event) => event.stopPropagation()}>
                      <summary>View {history.length} updates</summary>
                      {/* The left rule and indent this had were Bootstrap's
                          `border-start ps-2`; the disclosure already marks the
                          entries as subordinate, so the nesting is carried by
                          the control rather than by a border with no
                          design-system equivalent. */}
                      <div class="pk-stack pk-stack--tight">
                        {history.map((change) => (
                          <div key={change.changedAt} class="pk-stack pk-stack--tight">
                            {change.transitions.map((transition) => (
                              <div key={`${transition.fromType}->${transition.toType}`}>
                                {attendanceTypeLabel(transition.fromType)} → {attendanceTypeLabel(transition.toType)}
                                <span class="pk-muted">
                                  {" "}
                                  · {transition.days.map((day) => day.label ?? day.dayDate).join(", ")}
                                </span>
                              </div>
                            ))}
                            <div class="pk-muted pk-mono">{fmt(change.changedAt)}</div>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ) : (
                "—"
              );
            },
          },
        ]
      : []),
    ...(!attendanceChangeFilter
      ? [
          {
            header: "Consent",
            /*
             * A green tick with a `title` was the whole signal: colour, which
             * not every reader can separate, plus a tooltip a screen reader
             * and a touch device never surface. The mark stays as the visual
             * and the word goes beside it, hidden, so the cell is announced
             * as "Consented" rather than as a tick.
             */
            cell: (r: Registration) =>
              r.sponsor_consent === true ? (
                <>
                  <span aria-hidden="true">✓</span>
                  <span class="pk-sr-only">Consented to share with sponsors</span>
                </>
              ) : r.sponsor_consent === false ? (
                <>
                  <span class="pk-muted" aria-hidden="true">
                    —
                  </span>
                  <span class="pk-sr-only">No sponsor consent</span>
                </>
              ) : (
                <>
                  <span class="pk-muted" aria-hidden="true">
                    —
                  </span>
                  <span class="pk-sr-only">Not asked</span>
                </>
              ),
            className: "pk-center",
            width: "fit" as const,
            filter: {
              param: "consent",
              options: [
                { value: "", label: "All consent" },
                { value: "true", label: "Sponsor consent given" },
                { value: "false", label: "No sponsor consent" },
              ],
            },
          },
          { header: "Source", cell: (r: Registration) => r.source_type ?? "—", className: "pk-small pk-muted" },
          {
            header: "Registered",
            cell: (r: Registration) => fmtDate(r.created_at),
            className: "pk-mono pk-small",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" as const },
          },
        ]
      : []),
    /*
     * The row itself is the link — `rowAction` renders a real control and
     * stretches it over the row — so this column is the affordance a reader
     * sees, not a second control. It used to be a `<span>` wearing button
     * classes, which announced nothing and looked like something to press.
     */
    {
      header: { label: "View", className: "pk-end" },
      cell: () => (
        <span class="pk-muted" aria-hidden="true">
          View →
        </span>
      ),
    },
  ];

  return (
    <div class="pk pk-stack">
      {stats && <RegistrationTotals stats={stats} />}
      <ApiDataTable
        caption="Event registrations"
        endpoint={eventRegistrationsPath(slug)}
        responseSchema={eventRegistrationsListResponseSchema}
        resolve={(data) => data.registrations}
        resolvePage={(data) => data.page}
        onData={(data) => setStats(data.stats)}
        paginate
        searchPlaceholder="Search name / email…"
        params={attendanceChangeFilter ? { attendance_change: attendanceChangeFilter } : {}}
        actionsRef={tableRef}
        toolbar={({ resetPage }) => (
          <>
            {/* Status, email delivery and sponsor consent narrow from their
                own columns' menus. This one stays: it is a view of the list
                rather than a value a column shows, arrived at from the
                attendance dashboard's links as much as from here. */}
            <FilterSelect
              ariaLabel="Attendance changes"
              value={attendanceChangeFilter}
              options={[
                { value: "", label: "All attendance activity" },
                ...eventRegistrationAttendanceChangeFilterSchema.options.map((change) => ({
                  value: change,
                  label: EVENT_REGISTRATION_ATTENDANCE_CHANGE_LABELS[change],
                })),
              ]}
              onChange={(value) => {
                setAttendanceChangeFilter(value);
                resetPage();
              }}
            />
            <RegistrationRosterActions
              promotionsEndpoint={eventRegistrationPromotionsPath(slug)}
              exportsEndpoint={eventRegistrationExportsPath(slug)}
              onPromoted={() => tableRef.current?.reload()}
              notify={toast}
            />
          </>
        )}
        columns={columns}
        empty={attendanceChangeFilter ? "No attendees match this attendance change" : "No registrations yet"}
        rowKey={(r) => r.id}
        rowAction={(r) => ({
          label: `View registration for ${r.display_name ?? r.user_email ?? "this attendee"}`,
          href: usePortalHashLocation.hrefs(eventRegistrationViewPath(slug, r.id)),
        })}
      />
    </div>
  );
}

// ─── Registrations compositor ─────────────────────────────────────────────────

export function Registrations({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = usePortalHashLocation();
  const tab = subTab === "responses" || subTab === "email" ? subTab : "overview";

  return (
    <div class="pk pk-stack">
      {/* The tab set is named, so it is not one of several anonymous
          "Sections" strips when a reader lists the page's landmarks. */}
      <Tabs
        label="Registration sections"
        items={[
          { key: "overview", label: "Overview" },
          { key: "responses", label: "Responses" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/registrations/${key === "overview" ? "" : key}`)}
      />

      {tab === "overview" && (
        <RegistrationsList
          key={`${slug}:${subTab ?? "overview"}`}
          slug={slug}
          initialAttendanceChange={ATTENDANCE_CHANGE_PRESETS[subTab ?? ""] ?? ""}
        />
      )}
      {tab === "responses" && <EventFormResponses slug={slug} purpose="event_registration" />}
      {tab === "email" && (
        <EventEmailCampaign
          campaignsPath={`/api/v1/events/${encodeURIComponent(slug)}/email/campaigns`}
          daysPath={`/api/v1/events/${encodeURIComponent(slug)}/days`}
          audience="attendees"
          notify={toast}
        />
      )}
    </div>
  );
}
