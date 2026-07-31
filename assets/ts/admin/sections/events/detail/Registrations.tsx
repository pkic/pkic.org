import { useState, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions, type Column } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { ATTENDANCE_TYPE_LABELS, attendanceTypeLabel } from "../../../attendance";
import { fmt, toast } from "../../../ui";
import type { Registration, RegistrationAttendanceChange } from "../../../types";
import { Invites } from "./Invites";
import { EventEmail } from "./EventEmail";
import { EventFormResponses } from "./Forms";

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

interface RegistrationStats {
  byAttendanceType: Record<string, number>;
  attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
  byStatus: Record<string, number>;
  bouncedCount?: number;
  consentCount?: number;
  dietaryCounts?: Record<string, number>;
}

// ─── Registration list ────────────────────────────────────────────────────────

function RegistrationsList({ slug, initialAttendanceChange = "" }: { slug: string; initialAttendanceChange?: string }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [bouncedFilter, setBouncedFilter] = useState("");
  const [consentFilter, setConsentFilter] = useState("");
  const [attendanceChangeFilter, setAttendanceChangeFilter] = useState(initialAttendanceChange);
  const [stats, setStats] = useState<RegistrationStats | null>(null);
  const [, navigate] = useHashLocation();
  const tableRef = useRef<ApiTableActions | null>(null);

  async function runWaitlistPromotions() {
    try {
      await api(`/api/v1/admin/events/${slug}/waitlist/promote`, { method: "POST", body: "{}" });
      toast("Waitlist promotions run", "success");
      tableRef.current?.reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  function downloadCsv() {
    window.location.href = `/api/v1/admin/events/${slug}/registrations/export`;
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
              <span class="text-muted small">{r.user_email}</span>
            </>
          )}
        </>
      ),
      sort: { asc: "display_name", desc: "-display_name" },
    },
    {
      header: "Status",
      cell: (r) => (
        <>
          <Badge status={r.status} />
          {r.has_bounced && <Badge status="bounced" />}
        </>
      ),
      sort: { asc: "status", desc: "-status" },
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
                <div class="small">
                  <div class="fw-semibold">{attendanceJourneyLabel(history)}</div>
                  <div class="text-muted mono">Last changed {fmt(latest.changedAt)}</div>
                  {history.length > 1 && (
                    <details class="mt-1" onClick={(event) => event.stopPropagation()}>
                      <summary class="text-primary">View {history.length} updates</summary>
                      <div class="mt-1 border-start ps-2">
                        {history.map((change) => (
                          <div key={change.changedAt} class="mb-1">
                            {change.transitions.map((transition) => (
                              <div key={`${transition.fromType}->${transition.toType}`}>
                                {attendanceTypeLabel(transition.fromType)} → {attendanceTypeLabel(transition.toType)}
                                <span class="text-muted">
                                  {" "}
                                  · {transition.days.map((day) => day.label ?? day.dayDate).join(", ")}
                                </span>
                              </div>
                            ))}
                            <div class="text-muted mono">{fmt(change.changedAt)}</div>
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
            cell: (r: Registration) =>
              r.sponsor_consent === true ? (
                <span class="text-success" title="Consented to share with sponsors">
                  ✓
                </span>
              ) : r.sponsor_consent === false ? (
                <span class="text-muted">—</span>
              ) : (
                "—"
              ),
            className: "text-center",
          },
          { header: "Source", cell: (r: Registration) => r.source_type ?? "—", className: "small text-muted" },
          {
            header: "Registered",
            cell: (r: Registration) => fmt(r.created_at),
            className: "mono small",
            sort: { asc: "created_at", desc: "-created_at", defaultDirection: "desc" },
          },
        ]
      : []),
    { header: "", cell: () => <span class="btn btn-sm btn-outline-secondary">View →</span> },
  ];

  return (
    <div>
      {stats && (
        <div class="adm-mini-stats mb-3">
          <span class="adm-mini-stat">
            <strong class="text-success">{accepted}</strong> accepted
          </span>
          {waitlisted > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-info">{waitlisted}</strong> waitlisted
            </span>
          )}
          {pendingConfirmation > 0 && (
            <span class="adm-mini-stat">
              <strong class="text-warning">{pendingConfirmation}</strong> pending
            </span>
          )}
          <span class="adm-mini-stat">
            <strong>{total}</strong> total
          </span>
          <span class="adm-mini-stat-sep" />
          {attendanceStatuses
            .filter(({ accepted, waitlisted }) => accepted + waitlisted > 0)
            .map(({ type, label, accepted, waitlisted }) => (
              <span key={type} class="adm-mini-stat">
                <strong>{accepted}</strong> {label}
                {waitlisted > 0 && <span class="text-info"> (+{waitlisted} waitlisted)</span>}
              </span>
            ))}
          {bouncedCount > 0 && (
            <>
              <span class="adm-mini-stat-sep" />
              <span class="adm-mini-stat">
                <strong class="text-danger">{bouncedCount}</strong> bounced
              </span>
            </>
          )}
        </div>
      )}
      <ApiDataTable<Registration>
        endpoint={`/api/v1/admin/events/${slug}/registrations`}
        resolve={(d) => {
          const resp = d as { registrations: Registration[]; stats?: RegistrationStats };
          if (resp.stats) setStats(resp.stats);
          return resp.registrations;
        }}
        resolvePage={(d) => (d as { page: { total: number; hasMore: boolean } }).page}
        paginate
        searchPlaceholder="Search name / email…"
        params={{
          ...(statusFilter && { status: statusFilter }),
          ...(bouncedFilter && { bounced: bouncedFilter }),
          ...(consentFilter && { consent: consentFilter }),
          ...(attendanceChangeFilter && { attendance_change: attendanceChangeFilter }),
        }}
        actionsRef={tableRef}
        deps={[slug, statusFilter, bouncedFilter, consentFilter, attendanceChangeFilter]}
        toolbar={({ resetPage }) => (
          <>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All statuses</option>
              <option value="registered">Confirmed</option>
              <option value="pending_email_confirmation">Pending confirmation</option>
              <option value="waitlisted">Waitlisted</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              aria-label="Attendance changes"
              class="form-select form-select-sm adm-filter-select"
              value={attendanceChangeFilter}
              onChange={(e) => {
                setAttendanceChangeFilter((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All attendance activity</option>
              <option value="any">Changed attendance</option>
              <option value="left_in_person">Left in-person and is no longer in-person</option>
              <option value="joined_in_person">Joined in-person and is currently in-person</option>
            </select>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={bouncedFilter}
              onChange={(e) => {
                setBouncedFilter((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All email statuses</option>
              <option value="true">Bounced</option>
              <option value="false">Not bounced</option>
            </select>
            <select
              class="form-select form-select-sm adm-filter-select"
              value={consentFilter}
              onChange={(e) => {
                setConsentFilter((e.target as HTMLSelectElement).value);
                resetPage();
              }}
            >
              <option value="">All consent</option>
              <option value="true">Sponsor consent given</option>
              <option value="false">No sponsor consent</option>
            </select>
            <button class="btn btn-sm btn-outline-warning" onClick={() => void runWaitlistPromotions()}>
              Run waitlist promotions
            </button>
            <button class="btn btn-sm btn-outline-secondary" onClick={downloadCsv}>
              Download CSV
            </button>
          </>
        )}
        columns={columns}
        empty={attendanceChangeFilter ? "No attendees match this attendance change" : "No registrations yet"}
        rowKey={(r) => r.id}
        rowClass={() => "adm-reg-row"}
        onRowClick={(r) => navigate(`/events/${slug}/registration/${r.id}`)}
      />
    </div>
  );
}

// ─── Registrations compositor ─────────────────────────────────────────────────

export function Registrations({ slug, subTab }: { slug: string; subTab?: string }) {
  const [, navigate] = useHashLocation();
  const tab = subTab === "invites" || subTab === "email" || subTab === "responses" ? subTab : "overview";

  return (
    <div>
      <Tabs
        items={[
          { key: "overview", label: "Overview" },
          { key: "responses", label: "Responses" },
          { key: "invites", label: "Attendee Invites" },
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
      {tab === "invites" && <Invites slug={slug} inviteType="attendee" />}
      {tab === "email" && <EventEmail slug={slug} audience="attendees" />}
    </div>
  );
}
