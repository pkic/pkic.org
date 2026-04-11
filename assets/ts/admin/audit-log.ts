import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { badge, esc, q, spinner, tbl } from "./ui";

export interface AuditLogEntry {
  id: string;
  actor_type: string;
  actor_id: string | null;
  actor_display: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogResponse {
  entries: AuditLogEntry[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

interface AuditLogState {
  q: string;
  entityType: string;
  actorType: string;
  action: string;
  offset: number;
  pageSize: number;
}

const state: AuditLogState = {
  q: "",
  entityType: "",
  actorType: "",
  action: "",
  offset: 0,
  pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
};

export function loadAuditLog(api: <T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }) => Promise<T>): Promise<void> {
  const el = q("#al-body");
  if (!el) return Promise.resolve();

  let offset = state.offset;
  let pageSize = state.pageSize;

  const doLoad = async (): Promise<void> => {
    el.innerHTML = spinner();
    state.offset = offset;
    state.pageSize = pageSize;

    const qs = new URLSearchParams({
      limit: String(pageSize),
      offset: String(offset),
    });
    if (state.q) qs.set("q", state.q);
    if (state.entityType) qs.set("entityType", state.entityType);
    if (state.actorType) qs.set("actorType", state.actorType);
    if (state.action) qs.set("action", state.action);

    try {
      const data = await api<AuditLogResponse>(`/api/v1/admin/audit-log?${qs.toString()}`);

      const rows = data.entries.map((entry) => {
        const actorHtml = entry.actor_type === "system"
          ? `<span class="text-muted">System</span>`
          : entry.actor_display
            ? esc(entry.actor_display)
            : entry.actor_id
              ? `<span class="text-muted small mono">${esc(entry.actor_id)}</span>`
              : `<span class="text-muted">${esc(entry.actor_type)}</span>`;
        const detailsHtml = entry.details
          ? `<pre class="mb-0 small text-body-secondary adm-auditlog-details">${esc(JSON.stringify(entry.details, null, 2))}</pre>`
          : "";
        const ts = new Date(entry.created_at).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" });
        return `<tr>
          <td class="text-nowrap small text-muted">${esc(ts)}</td>
          <td class="small">${actorHtml}<div class="text-muted small">${esc(entry.actor_type)}</div></td>
          <td><code class="small">${esc(entry.action)}</code></td>
          <td class="small text-muted">${badge(entry.entity_type)}</td>
          <td class="mono small text-muted">${entry.entity_id ? esc(entry.entity_id) : "—"}</td>
          <td>${detailsHtml}</td>
        </tr>`;
      }).join("");

      const currentPage = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;
      el.innerHTML =
        `<div class="d-flex gap-2 align-items-end flex-wrap mb-3">` +
          `<div>` +
            `<label class="form-label small mb-1">Search</label>` +
            `<input type="search" class="form-control form-control-sm adm-auditlog-input" id="al-q" placeholder="action, entity, details…" value="${esc(state.q)}">` +
          `</div>` +
          `<div>` +
            `<label class="form-label small mb-1">Entity type</label>` +
            `<select class="form-select form-select-sm" id="al-entity-type">` +
              `<option value="">All</option>` +
              `${["registration","event","user","form","invite","event_permission","proposal","headshot","auth"].map((t) =>
                `<option value="${t}"${state.entityType === t ? " selected" : ""}>${t}</option>`
              ).join("")}` +
            `</select>` +
          `</div>` +
          `<div>` +
            `<label class="form-label small mb-1">Actor type</label>` +
            `<select class="form-select form-select-sm" id="al-actor-type">` +
              `<option value="">All</option>` +
              `${["admin","system","user"].map((t) =>
                `<option value="${t}"${state.actorType === t ? " selected" : ""}>${t}</option>`
              ).join("")}` +
            `</select>` +
          `</div>` +
          `<div>` +
            `<label class="form-label small mb-1">Action</label>` +
            `<input type="search" class="form-control form-control-sm adm-auditlog-input" id="al-action" placeholder="e.g. force_status" value="${esc(state.action)}">` +
          `</div>` +
          `<button class="btn btn-sm btn-primary" id="al-apply">Apply</button>` +
          `<button class="btn btn-sm btn-outline-secondary" id="al-reset">Reset</button>` +
        `</div>` +
        (data.entries.length === 0
          ? `<p class="text-muted">No entries match the current filters.</p>`
          : `<div class="table-responsive">` +
            `<table class="table table-sm align-middle mb-2">` +
            `<thead class="table-light"><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>Details</th></tr></thead>` +
            `<tbody>${rows}</tbody>` +
            `</table></div>`
        ) +
        `<div id="al-pager" class="mt-2">${pagerHtml(currentPage, data.page.hasMore, pageSize, offset, data.entries.length, data.page.total)}</div>`;

      const applyFilters = (): void => {
        state.q = (q<HTMLInputElement>("#al-q")?.value ?? "").trim();
        state.entityType = q<HTMLSelectElement>("#al-entity-type")?.value ?? "";
        state.actorType = q<HTMLSelectElement>("#al-actor-type")?.value ?? "";
        state.action = (q<HTMLInputElement>("#al-action")?.value ?? "").trim();
        state.offset = 0;
        offset = 0;
        void doLoad();
      };

      q<HTMLButtonElement>("#al-apply")?.addEventListener("click", applyFilters);
      q<HTMLInputElement>("#al-q")?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
      q<HTMLInputElement>("#al-action")?.addEventListener("keydown", (e) => { if (e.key === "Enter") applyFilters(); });
      q<HTMLSelectElement>("#al-entity-type")?.addEventListener("change", applyFilters);
      q<HTMLSelectElement>("#al-actor-type")?.addEventListener("change", applyFilters);
      q<HTMLButtonElement>("#al-reset")?.addEventListener("click", () => {
        state.q = "";
        state.entityType = "";
        state.actorType = "";
        state.action = "";
        state.offset = 0;
        state.pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;
        offset = 0;
        pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;
        void doLoad();
      });

      const pagerEl = q("#al-pager");
      pagerEl?.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
        if (offset > 0) {
          offset = Math.max(0, offset - pageSize);
          void doLoad();
        }
      });
      pagerEl?.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
        if (data.page.hasMore) {
          offset += pageSize;
          void doLoad();
        }
      });
      pagerEl?.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const page = parseInt(btn.dataset.pageJump!, 10);
          offset = (page - 1) * pageSize;
          void doLoad();
        });
      });
      pagerEl?.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (e) => {
        pageSize = parseInt((e.target as HTMLSelectElement).value, 10) || ADMIN_LIST_PAGE_SIZE_DEFAULT;
        offset = 0;
        void doLoad();
      });
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  };

  q<HTMLButtonElement>("#btn-auditlog-refresh")?.addEventListener("click", () => void doLoad());

  return doLoad();
}
