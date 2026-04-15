import { useState, useRef } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/Table";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { Registration } from "../../../types";
import { Invites } from "./Invites";
import { EventEmail } from "./EventEmail";

const ATT_LABELS: Record<string, string> = { in_person: "In-person", virtual: "Virtual", on_demand: "On-demand" };

function attendanceTypeLabel(t: string): string {
  return ATT_LABELS[t] ?? t;
}

interface RegistrationStats {
  byAttendanceType: Record<string, number>;
  byStatus: Record<string, number>;
  bouncedCount?: number;
}

// ─── Registration list ────────────────────────────────────────────────────────

function RegistrationsList({ slug }: { slug: string }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [bouncedFilter, setBouncedFilter] = useState("");
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

  const confirmed = stats?.byStatus?.registered ?? 0;
  const waitlisted = stats?.byStatus?.waitlisted ?? 0;
  const pendingConfirmation = stats?.byStatus?.pending_email_confirmation ?? 0;
  const total = stats ? Object.values(stats.byStatus).reduce((s, v) => s + v, 0) : 0;
  const inPerson = stats?.byAttendanceType?.in_person ?? 0;
  const virtual = stats?.byAttendanceType?.virtual ?? 0;
  const onDemand = stats?.byAttendanceType?.on_demand ?? 0;
  const bouncedCount = stats?.bouncedCount ?? 0;

  return (
    <div>
      {stats && (
        <div class="adm-mini-stats mb-3">
          <span class="adm-mini-stat">
            <strong class="text-success">{confirmed}</strong> confirmed
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
          {inPerson > 0 && (
            <span class="adm-mini-stat">
              <strong>{inPerson}</strong> in-person
            </span>
          )}
          {virtual > 0 && (
            <span class="adm-mini-stat">
              <strong>{virtual}</strong> virtual
            </span>
          )}
          {onDemand > 0 && (
            <span class="adm-mini-stat">
              <strong>{onDemand}</strong> on-demand
            </span>
          )}
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
        params={{ ...(statusFilter && { status: statusFilter }), ...(bouncedFilter && { bounced: bouncedFilter }) }}
        actionsRef={tableRef}
        deps={[slug, statusFilter, bouncedFilter]}
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
            <button class="btn btn-sm btn-outline-warning" onClick={() => void runWaitlistPromotions()}>
              Run waitlist promotions
            </button>
          </>
        )}
        columns={[
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
          },
          {
            header: "Status",
            cell: (r) => (
              <>
                <Badge status={r.status} />
                {r.has_bounced && <Badge status="bounced" />}
              </>
            ),
          },
          { header: "Attendance", cell: (r) => (r.attendance_type ? attendanceTypeLabel(r.attendance_type) : "—") },
          {
            header: "Day waitlist",
            cell: (r) =>
              r.dayWaitlistSummary ??
              (r.dayWaitlistCount ? `${r.dayWaitlistCount} day${r.dayWaitlistCount !== 1 ? "s" : ""}` : "—"),
          },
          { header: "Source", cell: (r) => r.source_type ?? "—", className: "small text-muted" },
          { header: "Registered", cell: (r) => fmt(r.created_at), className: "mono small" },
          { header: "", cell: () => <span class="btn btn-sm btn-outline-secondary">View →</span> },
        ]}
        empty="No registrations yet"
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
  const tab = subTab === "invites" || subTab === "email" ? subTab : "overview";

  return (
    <div>
      <Tabs
        items={[
          { key: "overview", label: "Overview" },
          { key: "invites", label: "Attendee Invites" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => navigate(`/events/${slug}/registrations/${key === "overview" ? "" : key}`)}
      />

      {tab === "overview" && <RegistrationsList slug={slug} />}
      {tab === "invites" && <Invites slug={slug} inviteType="attendee" />}
      {tab === "email" && <EventEmail slug={slug} audience="attendees" />}
    </div>
  );
}
