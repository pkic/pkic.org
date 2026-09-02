import { useState, useRef } from "preact/hooks";
import { usePortalHashLocation } from "../../../hash-location";
import { Badge } from "../../../../../components/Badge";
import type { Column } from "../../../../../components/Table";
import { ApiDataTable, type ApiTableActions } from "../../../../../components/ApiDataTable";
import { FilterSelect } from "../../../../../components/FilterSelect";
import { Tabs } from "../../../../../components/Tabs";
import { Button } from "../../../../../ui/Button";
import { postJson } from "../../../../../shared/api-client";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../attendance";
import { fmt, fmtDate, toast } from "../../../ui";
import type { Registration, RegistrationAttendanceChange } from "../types";
import { EventEmailCampaign } from "../../../../../components/events/EventEmailCampaign";
import { EventFormResponses } from "./Forms";
import {
  EVENT_REGISTRATION_STATUSES,
  eventRegistrationStatusLabel,
  eventRegistrationsListResponseSchema,
  type EventRegistrationsListResponse,
} from "../../../../../../shared/schemas/event-registrations";
import { eventRegistrationPromotionsResponseSchema } from "../../../../../../shared/schemas/route-contracts-event-registration-management";
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

  async function runWaitlistPromotions() {
    try {
      await postJson(eventRegistrationPromotionsPath(slug), {}, eventRegistrationPromotionsResponseSchema);
      toast("Waitlist promotions run", "success");
      await tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function downloadCsv() {
    window.location.href = eventRegistrationExportsPath(slug);
  }

  const pendingConfirmation = stats?.byStatus?.pending_email_confirmation ?? 0;
  const total = stats ? Object.values(stats.byStatus).reduce((s, v) => s + v, 0) : 0;
  const attendanceTypes = new Set([
    ...Object.keys(ATTENDANCE_TYPE_LABELS).filter((type) => type !== "not_attending"),
    ...Object.keys(stats?.attendanceStatusByType ?? {}),
  ]);
  const attendanceStatuses = [...attendanceTypes].map((type) => ({
    type,
    label: attendanceTypeLabel(type).toLowerCase(),
    accepted: stats?.attendanceStatusByType?.[type]?.accepted ?? 0,
    waitlisted: stats?.attendanceStatusByType?.[type]?.waitlisted ?? 0,
  }));
  const accepted = attendanceStatuses.reduce((sum, item) => sum + item.accepted, 0);
  const waitlisted = attendanceStatuses.reduce((sum, item) => sum + item.waitlisted, 0);
  const bouncedCount = stats?.bouncedCount ?? 0;
  const columns: Array<Column<Registration>> = [
    {
      header: "Name / Email",
      cell: (r) => (
        <>
          <strong class="adm-cell-name">{r.display_name ?? r.user_email ?? "—"}</strong>
          {r.display_name && r.user_email && (
            <>
              <br />
              <span class="pk-small">{r.user_email}</span>
            </>
          )}
        </>
      ),
      sort: { asc: "display_name", desc: "-display_name" },
    },
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
      header: "Attendance",
      cell: (r) => (r.attendance_type ? attendanceTypeLabel(r.attendance_type) : "—"),
      sort: { asc: "attendance_type", desc: "-attendance_type" },
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
    {
      header: "Day waitlist",
      cell: (r) =>
        r.dayWaitlistSummary ??
        (r.dayWaitlistCount ? `${r.dayWaitlistCount} day${r.dayWaitlistCount !== 1 ? "s" : ""}` : "—"),
    },
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

  /*
   * The tinted numbers are gone rather than translated. Each one already sits
   * beside the word that says what it counts — "accepted", "waitlisted",
   * "pending", "bounced" — so the colour was a second copy of a signal a
   * reader who cannot separate the hues never received in the first place.
   * This is the same call `EventStats` made when its two amber stat values
   * became a sentence.
   */
  return (
    <div class="pk pk-stack">
      {stats && (
        <div class="adm-mini-stats" role="group" aria-label="Registration totals">
          <span class="adm-mini-stat">
            <strong>{accepted}</strong> accepted
          </span>
          {waitlisted > 0 && (
            <span class="adm-mini-stat">
              <strong>{waitlisted}</strong> waitlisted
            </span>
          )}
          {pendingConfirmation > 0 && (
            <span class="adm-mini-stat">
              <strong>{pendingConfirmation}</strong> pending
            </span>
          )}
          <span class="adm-mini-stat">
            <strong>{total}</strong> total
          </span>
          <span class="adm-mini-stat-sep" aria-hidden="true" />
          {attendanceStatuses
            .filter(({ accepted, waitlisted }) => accepted + waitlisted > 0)
            .map(({ type, label, accepted, waitlisted }) => (
              <span key={type} class="adm-mini-stat">
                <strong>{accepted}</strong> {label}
                {waitlisted > 0 && <span> (+{waitlisted} waitlisted)</span>}
              </span>
            ))}
          {bouncedCount > 0 && (
            <>
              <span class="adm-mini-stat-sep" aria-hidden="true" />
              <span class="adm-mini-stat">
                <strong>{bouncedCount}</strong> bounced
              </span>
            </>
          )}
        </div>
      )}
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
              className="adm-filter-select"
              value={attendanceChangeFilter}
              options={[
                { value: "", label: "All attendance activity" },
                { value: "any", label: "Changed attendance" },
                { value: "left_in_person", label: "Left in-person and is no longer in-person" },
                { value: "joined_in_person", label: "Joined in-person and is currently in-person" },
              ]}
              onChange={(value) => {
                setAttendanceChangeFilter(value);
                resetPage();
              }}
            />
            <Button variant="secondary" size="sm" onClick={() => void runWaitlistPromotions()}>
              Run waitlist promotions
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadCsv}>
              Download CSV
            </Button>
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
