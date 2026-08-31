import type { ComponentChildren } from "preact";
import { Alert } from "../../../../../ui/Alert";
import { Badge, type BadgeTone } from "../../../../../ui/Badge";
import { Button } from "../../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../../ui/DataTable";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Spinner } from "../../../../../ui/Spinner";
import { StatCard } from "../../../../../ui/StatCard";
import { statusLabel } from "../../../../../components/Badge";
import { friendlyErrorMessage } from "../../../../../components/ErrorAlert";
import { getJson } from "../../../../../shared/api-client";
import { eventAnalyticsResponseSchema } from "../../../../../../shared/schemas/event-analytics";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../attendance";
import { svgStackedBarChart, isoDateRange } from "../../../../../components/analytics/charts";
import type { EventStatsResponse } from "../types";
import { useData } from "../../../../../hooks/useData";
import { AttendanceChangeDashboard } from "./AttendanceChangeDashboard";

/**
 * Chart fills read the state tokens rather than brand hexes, so the bars stay
 * legible on both grounds instead of being a light-theme palette painted onto
 * a dark surface. The tones come from the independent state scale, not the
 * accent: an accent-derived "virtual" would be indistinguishable from a
 * primary control on a green-accented product.
 */
const ATTENDANCE_TOKEN: Record<string, string> = {
  in_person: "--pk-info",
  virtual: "--pk-ok",
  on_demand: "--pk-warn",
};

function attendanceFill(type: string): string {
  return `var(${ATTENDANCE_TOKEN[type] ?? "--pk-ink-muted"})`;
}

/**
 * The pending half of a stacked pair. Mixed toward the surface rather than
 * taken from the `-soft` tints, which are backgrounds: as a bar fill they are
 * pale enough to read as empty.
 */
function attendancePendingFill(type: string): string {
  return `color-mix(in oklab, ${attendanceFill(type)} 38%, var(--pk-surface))`;
}

/** Invite lifecycle tones. The wording stays canonical through `statusLabel`. */
const INVITE_STATUS_TONE: Record<string, BadgeTone> = {
  sent: "info",
  accepted: "ok",
  declined: "danger",
  revoked: "warn",
  expired: "neutral",
};

/** "sent" reads as "Pending" from an invite-recipient's point of view — override the default status label. */
function inviteBadge(status: string) {
  return (
    <Badge tone={INVITE_STATUS_TONE[status] ?? "neutral"}>{status === "sent" ? "Pending" : statusLabel(status)}</Badge>
  );
}

interface CountRow {
  key: string;
  label: ComponentChildren;
  count: number;
}

function countColumns(header: string): ReadonlyArray<DataTableColumn<CountRow>> {
  return [
    { id: "label", header, cell: (row) => row.label },
    { id: "count", header: "Count", align: "end", cell: (row) => row.count },
  ];
}

const countRowKey = (row: CountRow): string => row.key;

interface DeclineReasonRow {
  key: string;
  reason: string;
  count: number;
  unsubscribed: number;
}

const DECLINE_REASON_COLUMNS: ReadonlyArray<DataTableColumn<DeclineReasonRow>> = [
  { id: "reason", header: "Reason", cell: (row) => row.reason },
  { id: "count", header: "Count", align: "end", cell: (row) => row.count },
  { id: "unsubscribed", header: "Unsubscribed", align: "end", cell: (row) => row.unsubscribed },
];

interface WaitlistDayRow {
  label: string;
  waiting: number;
  offered: number;
  accepted: number;
}

const WAITLIST_DAY_COLUMNS: ReadonlyArray<DataTableColumn<WaitlistDayRow>> = [
  { id: "day", header: "Event day", cell: (row) => row.label },
  { id: "waiting", header: "Waiting", align: "end", cell: (row) => row.waiting },
  { id: "offered", header: "Offered", align: "end", cell: (row) => row.offered },
  {
    id: "open",
    header: "Open now",
    align: "end",
    cell: (row) => <span class="pk-strong">{row.waiting + row.offered}</span>,
  },
  {
    id: "accepted",
    header: "Accepted historically",
    align: "end",
    cell: (row) => <span class="pk-muted">{row.accepted}</span>,
  },
];

export function EventStats({ slug }: { slug: string }) {
  const {
    data: stats,
    loading,
    error,
    reload,
  } = useData<EventStatsResponse>(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/analytics`, eventAnalyticsResponseSchema),
    [slug],
  );

  if (loading)
    return (
      <div class="pk">
        <Spinner label="Loading the event dashboard…" />
      </div>
    );
  if (error)
    return (
      <div class="pk">
        <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>
      </div>
    );
  if (!stats) return null;

  const s = stats;
  const consentGranted = s.registrations?.sponsorConsent?.granted ?? 0;
  const consentNotGranted = s.registrations?.sponsorConsent?.notGranted ?? 0;
  const consentTotal = consentGranted + consentNotGranted;
  const consentPct = consentTotal > 0 ? Math.round((consentGranted / consentTotal) * 100) : 0;
  const pendingConfirmation = s.registrations?.byStatus?.pending_email_confirmation ?? 0;

  const growthByDay = s.registrations?.growthByDay ?? [];
  const waitlistByEventDay = s.waitlistByEventDay ?? [];
  const waitlistTotals = s.waitlistTotals ?? { total: 0, byStatus: {}, byPriorityLane: {} };
  const attendanceChanges = s.attendanceChanges ?? {
    totalChanges: 0,
    changedRegistrations: 0,
    dayChanges: 0,
    changedAttendees: 0,
    leftInPersonAttendees: 0,
    leftInPersonDayChanges: 0,
    joinedInPersonAttendees: 0,
    joinedInPersonDayChanges: 0,
    byTransition: [],
    byDay: [],
    recent: [],
  };
  const registrationsByEventDay = s.registrationsByEventDay ?? [];
  const attendanceTypes = new Set(
    [...Object.keys(ATTENDANCE_TYPE_LABELS), ...Object.keys(s.registrations?.attendanceStatusByType ?? {})].filter(
      (type) => type !== "not_attending",
    ),
  );
  const attendanceStatuses = [...attendanceTypes].map((type) => ({
    type,
    label: attendanceTypeLabel(type),
    accepted: s.registrations?.attendanceStatusByType?.[type]?.accepted ?? 0,
    waitlisted: s.registrations?.attendanceStatusByType?.[type]?.waitlisted ?? 0,
  }));
  const waitlistedAttendees = attendanceStatuses.reduce((sum, item) => sum + item.waitlisted, 0);
  const acceptedAttendees = attendanceStatuses.reduce((sum, item) => sum + item.accepted, 0);

  /**
   * The Bootstrap surface tinted two stat values amber to mark them
   * actionable. StatCard has no warning variant by design — colour alone is
   * not a signal — so the same meaning is stated in words, once, in the
   * system's own device for it.
   */
  const needsAttention = [
    waitlistedAttendees > 0 ? `${String(waitlistedAttendees)} attendees are on an active day waitlist` : null,
    pendingConfirmation > 0 ? `${String(pendingConfirmation)} registrations have not confirmed their email` : null,
  ].filter((item): item is string => item !== null);

  // Growth chart
  const growthDates = (() => {
    const raw = [...new Set(growthByDay.map((r) => r.date))].sort();
    return raw.length > 1 ? isoDateRange(raw[0], raw[raw.length - 1]) : raw;
  })();
  const allAttTypes = [...new Set(growthByDay.map((r) => r.attendance_type))];
  const growthIdx: Record<string, Record<string, number>> = {};
  for (const r of growthByDay) {
    growthIdx[r.date] ??= {};
    growthIdx[r.date][r.attendance_type] = (growthIdx[r.date][r.attendance_type] ?? 0) + r.count;
  }
  const growthSeries = allAttTypes.map((at) => ({
    label: attendanceTypeLabel(at),
    color: attendanceFill(at),
    values: growthDates.map((d) => growthIdx[d]?.[at] ?? 0),
  }));

  // By-day chart
  const dayLabels = [...new Set(registrationsByEventDay.map((r) => r.label ?? r.day_date))];
  const dayAttTypes = [...new Set(registrationsByEventDay.map((r) => r.attendance_type))];
  const dayIdx: Record<string, Record<string, { accepted: number; pending: number }>> = {};
  for (const r of registrationsByEventDay) {
    const lbl = r.label ?? r.day_date;
    dayIdx[lbl] ??= {};
    dayIdx[lbl][r.attendance_type] ??= { accepted: 0, pending: 0 };
    if (r.attendance_status === "accepted") dayIdx[lbl][r.attendance_type].accepted += r.count;
    else dayIdx[lbl][r.attendance_type].pending += r.count;
  }
  const daySeries = dayAttTypes
    .flatMap((at) => [
      {
        label: `${attendanceTypeLabel(at)} – Accepted`,
        color: attendanceFill(at),
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.accepted ?? 0),
      },
      {
        label: `${attendanceTypeLabel(at)} – Pending`,
        color: attendancePendingFill(at),
        values: dayLabels.map((lbl) => dayIdx[lbl]?.[at]?.pending ?? 0),
      },
    ])
    .filter((sr) => sr.values.some((v) => v > 0));

  // Waitlist by event day
  const waitlistDayIdx: Record<string, Record<string, number>> = {};
  for (const r of waitlistByEventDay) {
    const lbl = r.label ?? r.day_date;
    waitlistDayIdx[lbl] ??= {};
    waitlistDayIdx[lbl][r.status] = (waitlistDayIdx[lbl][r.status] ?? 0) + r.count;
  }
  const waitlistDayRows: WaitlistDayRow[] = [...new Set(waitlistByEventDay.map((r) => r.label ?? r.day_date))].map(
    (label) => ({
      label,
      waiting: waitlistDayIdx[label]?.waiting ?? 0,
      offered: waitlistDayIdx[label]?.offered ?? 0,
      accepted: waitlistDayIdx[label]?.accepted ?? 0,
    }),
  );
  const waitlistOpenCount = (waitlistTotals.byStatus?.waiting ?? 0) + (waitlistTotals.byStatus?.offered ?? 0);
  const waitlistAcceptedCount = waitlistTotals.byStatus?.accepted ?? 0;
  const waitlistOfferedCount = waitlistTotals.byStatus?.offered ?? 0;

  const rsvpStatusRows: CountRow[] = Object.entries(s.rsvp?.byStatus ?? {}).map(([status, count]) => ({
    key: status,
    label: statusLabel(status),
    count,
  }));
  const rsvpActionRows: CountRow[] = Object.entries(s.rsvp?.actionsTaken ?? {}).map(([action, count]) => ({
    key: action,
    label: statusLabel(action),
    count,
  }));

  return (
    <div class="pk pk-stack">
      <Panel>
        <PanelHeader title="Event dashboard" headingLevel={2}>
          <Button size="sm" onClick={() => void reload()}>
            <span aria-hidden="true">↺</span> Refresh
          </Button>
        </PanelHeader>
        <PanelBody class="pk-stack">
          <p class="pk-small">Current attendee status, movement, waitlist pressure, and event activity.</p>

          <div class="pk-grid pk-grid--tight">
            <StatCard label="Accepted attendees" value={String(acceptedAttendees)} note="not on an active waitlist" />
            <StatCard
              label="Waitlisted attendees"
              value={String(waitlistedAttendees)}
              note="unique people with an active day waitlist"
            />
            <StatCard label="Pending confirmation" value={String(pendingConfirmation)} note="email not confirmed" />
            <StatCard label="Total registrations" value={String(s.registrations?.total ?? 0)} note="all statuses" />
            {s.proposals && (
              <StatCard label="Proposals" value={String(s.proposals.total)} note="all proposal statuses" />
            )}
            <StatCard
              label="Sponsor consent"
              value={String(consentGranted)}
              note={`${String(consentPct)}% of ${String(consentTotal)}`}
            />
          </div>

          {needsAttention.length > 0 && (
            <Alert tone="warn" title="Needs attention">
              {needsAttention.join(" · ")}
            </Alert>
          )}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title="Attendance status" headingLevel={2} />
        <PanelBody>
          <div class="pk-grid pk-grid--tight">
            {attendanceStatuses.map(({ type, label, accepted, waitlisted }) => (
              <StatCard
                key={type}
                label={`${label} accepted`}
                value={String(accepted)}
                note={waitlisted > 0 ? `+${String(waitlisted)} waitlisted` : "No active waitlist"}
              />
            ))}
          </div>
        </PanelBody>
      </Panel>

      <AttendanceChangeDashboard slug={slug} changes={attendanceChanges} />

      <Panel>
        <PanelHeader title="Registrations received by day" headingLevel={2} />
        <PanelBody>
          {growthDates.length > 0 && growthSeries.length > 0 ? (
            <div
              dangerouslySetInnerHTML={{
                __html: svgStackedBarChart(
                  growthDates.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`),
                  growthSeries,
                  { isoLabels: growthDates },
                ),
              }}
            />
          ) : (
            <EmptyState title="No registrations yet." />
          )}
        </PanelBody>
      </Panel>

      {dayLabels.length > 0 && (
        <Panel>
          <PanelHeader title="Registrations by event day" headingLevel={2} />
          <PanelBody class="pk-stack pk-stack--snug">
            {/* The chart's own legend names each series; this key explains what
                the two shades within a series mean. The badge dot repeats the
                tone as a shape, so it does not rest on colour alone. */}
            <div class="pk-cluster">
              <Badge tone="ok">solid = accepted</Badge>
              <Badge tone="neutral">light = pending/waitlisted</Badge>
            </div>
            {daySeries.length > 0 ? (
              <div dangerouslySetInnerHTML={{ __html: svgStackedBarChart(dayLabels, daySeries) }} />
            ) : (
              <EmptyState title="No registrations on any event day yet." />
            )}
          </PanelBody>
        </Panel>
      )}

      {waitlistDayRows.length > 0 && (
        <Panel>
          <PanelHeader title="Open waitlist by event day" headingLevel={2} />
          <PanelBody class="pk-stack">
            <div class="pk-grid pk-grid--tight">
              <StatCard label="Open day entries" value={String(waitlistOpenCount)} note="waiting + offered" />
              <StatCard
                label="Offers awaiting response"
                value={String(waitlistOfferedCount)}
                note="included in open entries"
              />
              <StatCard label="Accepted from waitlist" value={String(waitlistAcceptedCount)} note="historical total" />
            </div>
            <DataTable
              caption="Open waitlist by event day"
              columns={WAITLIST_DAY_COLUMNS}
              rows={waitlistDayRows}
              rowKey={(row) => row.label}
            />
          </PanelBody>
        </Panel>
      )}

      <div class="pk-grid pk-grid--roomy">
        {(["attendee", "speaker"] as const).map((type) => {
          const inv = s.invites?.[type];
          if (!inv) return null;
          const declineReasons = inv.declineReasons ?? [];
          const title = type === "attendee" ? "Attendee invites" : "Speaker invites";
          const inviteRows: CountRow[] = [
            ...Object.entries(inv.byStatus ?? {}).map(([status, count]) => ({
              key: status,
              label: inviteBadge(status),
              count,
            })),
            { key: "__total", label: <span class="pk-strong">Total</span>, count: inv.total ?? 0 },
          ];
          return (
            <Panel key={type}>
              <PanelHeader title={title} headingLevel={2} />
              <PanelBody class="pk-stack pk-stack--snug">
                <DataTable
                  caption={`${title} by status`}
                  columns={countColumns("Status")}
                  rows={inviteRows}
                  rowKey={countRowKey}
                />
                {declineReasons.length > 0 && (
                  <>
                    <p class="pk-strong pk-small">Decline reasons</p>
                    <DataTable
                      caption={`${title}: decline reasons`}
                      columns={DECLINE_REASON_COLUMNS}
                      rows={declineReasons.map((dr, index) => ({
                        key: dr.reason_code ?? `unspecified-${String(index)}`,
                        reason: dr.reason_code ?? "Not specified",
                        count: dr.count,
                        unsubscribed: dr.unsubscribed,
                      }))}
                      rowKey={(row) => row.key}
                    />
                  </>
                )}
              </PanelBody>
            </Panel>
          );
        })}
      </div>

      {(s.rsvp?.total ?? 0) > 0 && (
        <Panel>
          <PanelHeader title={`Calendar RSVP (${String(s.rsvp.total)})`} headingLevel={2} />
          <PanelBody>
            <div class="pk-grid pk-grid--roomy">
              <DataTable
                caption="By status"
                showCaption
                columns={countColumns("Status")}
                rows={rsvpStatusRows}
                rowKey={countRowKey}
              />
              {rsvpActionRows.length > 0 && (
                <DataTable
                  caption="Actions taken"
                  showCaption
                  columns={countColumns("Action")}
                  rows={rsvpActionRows}
                  rowKey={countRowKey}
                />
              )}
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
