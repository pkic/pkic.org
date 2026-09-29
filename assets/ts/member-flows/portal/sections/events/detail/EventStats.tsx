import { Alert } from "../../../../../ui/Alert";
import { Badge } from "../../../../../ui/Badge";
import { Button } from "../../../../../ui/Button";
import { statusBars } from "../../../../../ui/chart";
import { IconRefresh } from "../../../../../components/icons";
import { EmptyState } from "../../../../../ui/EmptyState";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Spinner } from "../../../../../ui/Spinner";
import { StatCard } from "../../../../../ui/StatCard";
import { Tabs } from "../../../../../components/Tabs";
import { usePortalHashLocation } from "../../../hash-location";
import { statusLabel } from "../../../../../components/Badge";
import { friendlyErrorMessage } from "../../../../../components/ErrorAlert";
import { getJson } from "../../../../../shared/api-client";
import { eventAnalyticsResponseSchema } from "../../../../../../shared/schemas/event-analytics";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../../../../../shared/attendance";
import { StackedBarChart } from "../../../../../ui/StackedBarChart";
import { isoDateRange } from "../../../../../components/analytics/date-range";
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

interface WaitlistDayRow {
  label: string;
  waiting: number;
  offered: number;
  accepted: number;
}

/** The page's sections, each a routed tab (#118). */
type StatsSection = "overview" | "attendance" | "registrations" | "invitations" | "calendar";
const STATS_SECTIONS: ReadonlyArray<{ key: StatsSection; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "attendance", label: "Attendance" },
  { key: "registrations", label: "Registrations" },
  { key: "invitations", label: "Invitations" },
  { key: "calendar", label: "Calendar" },
];

export function EventStats({
  slug,
  section,
  basePath = `/events/${encodeURIComponent(slug)}/stats`,
}: {
  slug: string;
  /** The routed section below the tab; the overview when absent. */
  section?: string;
  /** Where the sections live, so the tabs stay inside the workspace that rendered them. */
  basePath?: string;
}) {
  const [, navigate] = usePortalHashLocation();
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

  const rsvpStatusRows = Object.entries(s.rsvp?.byStatus ?? {}).map(([status, count]) => ({
    key: status,
    label: statusLabel(status),
    count,
  }));
  const rsvpActionRows = Object.entries(s.rsvp?.actionsTaken ?? {}).map(([action, count]) => ({
    key: action,
    label: statusLabel(action),
    count,
  }));

  // The sections a reader can open: the calendar only once something has
  // been answered, and the invitation section only when invitations exist.
  const hasInvites = Boolean(s.invites?.attendee || s.invites?.speaker);
  const hasRsvp = (s.rsvp?.total ?? 0) > 0;
  const sections = STATS_SECTIONS.filter(
    ({ key }) => (key !== "calendar" || hasRsvp) && (key !== "invitations" || hasInvites),
  );
  const active: StatsSection = sections.find(({ key }) => key === section)?.key ?? "overview";
  const hrefFor = (key: string) => (key === "overview" ? basePath : `${basePath}/${key}`);

  return (
    <div class="pk pk-stack">
      {/* One page, several questions: how the event stands, how attendance is
          moving, how registrations arrived, how invitations fared. Each is a
          section with its own address rather than a column of every panel
          at once (#118). */}
      <Tabs
        label="Analytics sections"
        items={sections}
        active={active}
        onChange={(key) => navigate(hrefFor(key))}
        hrefFor={hrefFor}
      />

      {active === "overview" && (
        <>
          <Panel>
            <PanelHeader title="Event dashboard" headingLevel={2}>
              <Button onClick={() => void reload()} aria-label="Refresh dashboard" icon>
                <IconRefresh />
              </Button>
            </PanelHeader>
            <PanelBody class="pk-stack">
              <div class="pk-stat-row">
                {/* Each card's tone says what its number is — seated, waiting,
                    unconfirmed — beside the label that says so in words (#110). */}
                <StatCard
                  label="Accepted attendees"
                  value={String(acceptedAttendees)}
                  note="not on an active waitlist"
                  tone="ok"
                />
                <StatCard
                  label="Waitlisted attendees"
                  value={String(waitlistedAttendees)}
                  note="unique people with an active day waitlist"
                  tone={waitlistedAttendees > 0 ? "warn" : "neutral"}
                />
                <StatCard
                  label="Pending confirmation"
                  value={String(pendingConfirmation)}
                  note="email not confirmed"
                  tone={pendingConfirmation > 0 ? "info" : "neutral"}
                />
                <StatCard label="Total registrations" value={String(s.registrations?.total ?? 0)} note="all statuses" />
                {s.proposals && (
                  <StatCard label="Proposals" value={String(s.proposals.total)} note="all proposal statuses" />
                )}
                <StatCard
                  label="Sponsor consent"
                  value={String(consentGranted)}
                  note={`${String(consentPct)}% of ${String(consentTotal)}`}
                  tone="info"
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
              <div class="pk-stat-row">
                {attendanceStatuses.map(({ type, label, accepted, waitlisted }) => (
                  <StatCard
                    key={type}
                    label={`${label} accepted`}
                    value={String(accepted)}
                    note={waitlisted > 0 ? `+${String(waitlisted)} waitlisted` : "No active waitlist"}
                    tone={waitlisted > 0 ? "warn" : undefined}
                  />
                ))}
              </div>
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
                  <StackedBarChart labels={dayLabels} series={daySeries} caption="Registrations by event day" />
                ) : (
                  <EmptyState title="No registrations on any event day yet." />
                )}
              </PanelBody>
            </Panel>
          )}
        </>
      )}

      {active === "attendance" && <AttendanceChangeDashboard slug={slug} changes={attendanceChanges} />}

      {active === "registrations" && (
        <>
          <Panel>
            <PanelHeader title="Registrations received by day" headingLevel={2} />
            <PanelBody>
              {growthDates.length > 0 && growthSeries.length > 0 ? (
                <StackedBarChart
                  labels={growthDates.map((d) => `${d.slice(8)}/${d.slice(5, 7)}`)}
                  series={growthSeries}
                  caption="Registrations received by day"
                  isoLabels={growthDates}
                />
              ) : (
                <EmptyState title="No registrations yet." />
              )}
            </PanelBody>
          </Panel>

          {waitlistDayRows.length > 0 && (
            <Panel>
              <PanelHeader title="Open waitlist by event day" headingLevel={2} />
              <PanelBody class="pk-stack">
                <div class="pk-stat-row">
                  <StatCard
                    label="Open day entries"
                    value={String(waitlistOpenCount)}
                    note="waiting + offered"
                    tone={waitlistOpenCount > 0 ? "warn" : "neutral"}
                  />
                  <StatCard
                    label="Offers awaiting response"
                    value={String(waitlistOfferedCount)}
                    note="included in open entries"
                    tone={waitlistOfferedCount > 0 ? "info" : "neutral"}
                  />
                  <StatCard
                    label="Accepted from waitlist"
                    value={String(waitlistAcceptedCount)}
                    note="historical total"
                    tone="ok"
                  />
                </div>
              </PanelBody>
              <PanelBody>
                <StackedBarChart
                  caption="Open waitlist by event day"
                  labels={waitlistDayRows.map((row) => row.label)}
                  series={[
                    { label: "Waiting", values: waitlistDayRows.map((row) => row.waiting), color: "var(--pk-warn)" },
                    { label: "Offered", values: waitlistDayRows.map((row) => row.offered), color: "var(--pk-info)" },
                  ]}
                />
              </PanelBody>
            </Panel>
          )}
        </>
      )}

      {active === "invitations" && (
        <div class="pk-grid pk-grid--cards">
          {(["attendee", "speaker"] as const).map((type) => {
            const inv = s.invites?.[type];
            if (!inv) return null;
            const declineReasons = inv.declineReasons ?? [];
            const title = type === "attendee" ? "Attendee invites" : "Speaker invites";
            return (
              <Panel key={type} aria-label={title}>
                <PanelHeader title={title} headingLevel={2} />
                <PanelBody class="pk-stack">
                  <div
                    dangerouslySetInnerHTML={{
                      __html: statusBars(
                        Object.fromEntries(
                          Object.entries(inv.byStatus).map(([status, count]) => [
                            status === "sent" ? "Pending" : statusLabel(status),
                            count,
                          ]),
                        ),
                        inv.total,
                      ),
                    }}
                  />
                  {declineReasons.length > 0 && (
                    <section aria-label={`${title}: decline reasons`} class="pk-stack pk-stack--snug">
                      <h3 class="pk-panel__title">Decline reasons</h3>
                      <div
                        dangerouslySetInnerHTML={{
                          __html: statusBars(
                            Object.fromEntries(
                              declineReasons.map((row) => [row.reason_code ?? "Not specified", row.count]),
                            ),
                            declineReasons.reduce((sum, row) => sum + row.count, 0),
                          ),
                        }}
                      />
                      <p class="pk-small pk-muted">
                        {declineReasons.reduce((sum, row) => sum + row.unsubscribed, 0)} unsubscribed
                      </p>
                    </section>
                  )}
                </PanelBody>
              </Panel>
            );
          })}
        </div>
      )}

      {active === "calendar" && (
        <Panel>
          <PanelHeader title={`Calendar RSVP (${String(s.rsvp.total)})`} headingLevel={2} />
          <PanelBody>
            <div class="pk-stack">
              <h3 class="pk-panel__title">By status</h3>
              <div
                dangerouslySetInnerHTML={{
                  __html: statusBars(
                    Object.fromEntries(rsvpStatusRows.map((row) => [String(row.label), row.count])),
                    s.rsvp.total,
                  ),
                }}
              />
              {rsvpActionRows.length > 0 && (
                <>
                  <h3 class="pk-panel__title">Actions taken</h3>
                  <div
                    dangerouslySetInnerHTML={{
                      __html: statusBars(
                        Object.fromEntries(rsvpActionRows.map((row) => [String(row.label), row.count])),
                        rsvpActionRows.reduce((sum, row) => sum + row.count, 0),
                      ),
                    }}
                  />
                </>
              )}
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
