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

function attendanceTypeLabel(t: string): string {
  return { in_person: "In-person", virtual: "Virtual", on_demand: "On-demand" }[t] ?? t;
}

// ─── Registration list ────────────────────────────────────────────────────────

function RegistrationsList({ slug }: { slug: string }) {
  const [statusFilter, setStatusFilter] = useState("");
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

  return (
    <ApiDataTable<Registration>
      endpoint={`/api/v1/admin/events/${slug}/registrations`}
      resolve={(d) => (d as { registrations: Registration[] }).registrations}
      resolvePage={(d) => (d as { pagination: { total: number; hasMore: boolean } }).pagination}
      paginate
      searchPlaceholder="Search name / email…"
      params={statusFilter ? { status: statusFilter } : undefined}
      actionsRef={tableRef}
      deps={[slug, statusFilter]}
      toolbar={({ resetPage }) => (<>
        <select class="form-select form-select-sm adm-filter-select" value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); resetPage(); }}>
          <option value="">All statuses</option>
          <option value="registered">Confirmed</option>
          <option value="pending_email_confirmation">Pending confirmation</option>
          <option value="waitlisted">Waitlisted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button class="btn btn-sm btn-outline-warning" onClick={() => void runWaitlistPromotions()}>Run waitlist promotions</button>
      </>)}
      columns={[
        { header: "Name / Email", cell: (r) => <><strong class="adm-cell-name">{r.display_name ?? r.user_email ?? "—"}</strong>{r.display_name && r.user_email && <><br /><span class="text-muted small">{r.user_email}</span></>}</> },
        { header: "Status", cell: (r) => <Badge status={r.status} /> },
        { header: "Attendance", cell: (r) => r.attendance_type ? attendanceTypeLabel(r.attendance_type) : "—" },
        { header: "Day waitlist", cell: (r) => r.dayWaitlistSummary ?? (r.dayWaitlistCount ? `${r.dayWaitlistCount} day${r.dayWaitlistCount !== 1 ? "s" : ""}` : "—") },
        { header: "Source", cell: (r) => r.source_type ?? "—", className: "small text-muted" },
        { header: "Registered", cell: (r) => fmt(r.created_at), className: "mono small" },
        { header: "", cell: () => <span class="btn btn-sm btn-outline-secondary">View →</span> },
      ]}
      empty="No registrations yet"
      rowKey={(r) => r.id}
      rowClass={() => "adm-reg-row"}
      onRowClick={(r) => navigate(`/events/${slug}/registrations/${r.id}`)}
    />
  );
}

// ─── Registrations compositor ─────────────────────────────────────────────────

export function Registrations({ slug }: { slug: string }) {
  const [tab, setTab] = useState<"overview" | "invites" | "email">("overview");

  return (
    <div>
      <Tabs
        items={[
          { key: "overview", label: "Overview" },
          { key: "invites", label: "Invites" },
          { key: "email", label: "Email" },
        ]}
        active={tab}
        onChange={(key) => setTab(key as "overview" | "invites" | "email")}
      />

      {tab === "overview" && <RegistrationsList slug={slug} />}
      {tab === "invites" && <Invites slug={slug} />}
      {tab === "email" && <EventEmail slug={slug} audience="attendees" />}
    </div>
  );
}
