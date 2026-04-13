import { h } from "preact";
import { useState } from "preact/hooks";
import { useHashLocation } from "wouter/use-hash-location";
import { Badge } from "../../../../components/Badge";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { api } from "../../../api";
import { fmt, toast } from "../../../ui";
import type { Registration } from "../../../types";
import { useData } from "../../../../hooks/useData";
import { usePageState } from "../../../../hooks/usePageState";

function attendanceTypeLabel(t: string): string {
  return { in_person: "In-person", virtual: "Virtual", on_demand: "On-demand" }[t] ?? t;
}

// ─── Registration list ────────────────────────────────────────────────────────

interface RegsResponse {
  registrations: Registration[];
  pagination: { offset: number; limit: number; total: number; hasMore: boolean };
}

export function Registrations({ slug }: { slug: string }) {
  const { offset, pageSize, resetPage, pagerProps } = usePageState();
  const [search, setSearch] = useState("");
  const [pendingSearch, setPendingSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [, navigate] = useHashLocation();

  const { data, loading, error, reload } = useData<RegsResponse>(() => {
    const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
    if (search) params.set("q", search);
    if (statusFilter) params.set("status", statusFilter);
    return api<RegsResponse>(`/api/v1/admin/events/${slug}/registrations?${params}`);
  }, [slug, search, statusFilter, offset, pageSize]);

  const regs = data?.registrations ?? [];
  const total = data?.pagination?.total ?? 0;
  const hasMore = data?.pagination?.hasMore ?? false;

  function applySearch() { setSearch(pendingSearch); resetPage(); }

  async function runWaitlistPromotions() {
    try {
      await api(`/api/v1/admin/events/${slug}/waitlist/promote`, { method: "POST", body: "{}" });
      toast("Waitlist promotions run", "success");
      void reload();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  }

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-2 flex-wrap">
        <input
          type="search"
          class="form-control form-control-sm adm-search-input"
          placeholder="Search name / email…"
          value={pendingSearch}
          onInput={(e) => setPendingSearch((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(); }}
        />
        <select class="form-select form-select-sm adm-filter-select" value={statusFilter} onChange={(e) => { setStatusFilter((e.target as HTMLSelectElement).value); resetPage(); }}>
          <option value="">All statuses</option>
          <option value="registered">Confirmed</option>
          <option value="pending_email_confirmation">Pending confirmation</option>
          <option value="waitlisted">Waitlisted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button class="btn btn-sm btn-outline-secondary" onClick={applySearch}>Search</button>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void reload()}>↺ Refresh</button>
        <button class="btn btn-sm btn-outline-warning" onClick={() => void runWaitlistPromotions()}>Run waitlist promotions</button>
      </div>

      {loading ? <Spinner /> : error ? <ErrorAlert error={error} /> : (
        <>
          <div class="table-responsive">
            <table class="table table-sm table-hover">
              <thead>
                <tr>
                  <th>Name / Email</th>
                  <th>Status</th>
                  <th>Attendance</th>
                  <th>Day waitlist</th>
                  <th>Source</th>
                  <th>Registered</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {regs.length === 0 ? (
                  <tr><td colSpan={7} class="text-center text-muted fst-italic py-3">No registrations yet</td></tr>
                ) : regs.map((r) => {
                  const name = r.display_name ?? r.user_email ?? "—";
                  return (
                    <tr key={r.id} class="adm-reg-row" onClick={() => navigate(`/events/${slug}/registrations/${r.id}`)}>
                      <td>
                        <strong class="adm-cell-name">{name}</strong>
                        {r.display_name && r.user_email && <><br /><span class="text-muted small">{r.user_email}</span></>}
                      </td>
                      <td><Badge status={r.status} /></td>
                      <td>{r.attendance_type ? attendanceTypeLabel(r.attendance_type) : "—"}</td>
                      <td>{r.dayWaitlistSummary ?? (r.dayWaitlistCount ? `${r.dayWaitlistCount} day${r.dayWaitlistCount !== 1 ? "s" : ""}` : "—")}</td>
                      <td class="small text-muted">{r.source_type ?? "—"}</td>
                      <td class="mono small">{fmt(r.created_at)}</td>
                      <td>
                        <span class="btn btn-sm btn-outline-secondary">View →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager {...pagerProps(regs.length, total, hasMore)} />
        </>
      )}
    </div>
  );
}
