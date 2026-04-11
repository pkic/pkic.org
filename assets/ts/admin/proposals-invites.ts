import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { badge, esc, fmt, q, resetButton, setButtonLoading, spinner, tbl, toast } from "./ui";
import type { AdminInviteEntry, ApiFn, InviteRecord } from "./types";

const MAX_PROPOSAL_INVITES = 500;
const PROPOSAL_INVITE_BULK_THRESHOLD = 10;
const PROPOSAL_INVITE_CHUNK_SIZE = 900;

interface ProposalsInviteSectionDeps {
  inviteBadge: (status: string) => string;
  parseAdminInviteText: (text: string) => { valid: AdminInviteEntry[]; skipped: number };
  parseAdminCsv: (text: string) => { valid: AdminInviteEntry[]; skipped: number };
}

export function createProposalsInviteSection(
  api: ApiFn,
  deps: ProposalsInviteSectionDeps,
): {
  proposalInviteFormHtml: () => string;
  proposalInviteListHtml: () => string;
  wireProposalInviteForm: (slug: string) => void;
  loadProposalInvites: (slug: string, statusFilter?: string) => Promise<void>;
} {
  const { inviteBadge, parseAdminInviteText, parseAdminCsv } = deps;

  let _proposalInviteEntries: AdminInviteEntry[] = [];

  function proposalInviteFormHtml(): string {
    return (
      '<div id="admin-proposal-invite-wrap">' +
      '<div class="mb-3">' +
        '<label class="form-label small fw-semibold">Paste emails &amp; names'
        + ' <span class="text-muted fw-normal">for proposal invites (one per line or CSV)</span></label>' +
        '<textarea class="form-control form-control-sm" id="pinv-paste" rows="4"'
        + ' placeholder="alice@example.com&#10;Bob Smith &lt;bob@example.com&gt;&#10;carol.jones@company.com"></textarea>' +
        '<div class="mt-1 d-flex gap-2 align-items-center flex-wrap">' +
          '<button type="button" class="btn btn-sm btn-outline-secondary" id="pinv-parse-btn">Parse &darr;</button>' +
          '<label class="btn btn-sm btn-outline-secondary mb-0" for="pinv-csv">Upload CSV</label>' +
          '<input type="file" id="pinv-csv" accept=".csv,text/csv" class="visually-hidden">' +
          '<span class="form-text ms-1">CSV columns: <code>email</code>, <code>firstName</code> (opt.), <code>lastName</code> (opt.)</span>' +
        '</div>' +
      '</div>' +
      '<div class="d-flex gap-1 mb-1 small text-muted text-uppercase" style="font-size:.68rem;font-weight:600;padding:0 .1rem">' +
        '<span style="flex:1.2">First name</span>' +
        '<span style="flex:1.2">Last name</span>' +
        '<span style="flex:2">Email *</span>' +
        '<span style="width:1.8rem"></span>' +
      '</div>' +
      '<div id="pinv-rows" class="mb-2"></div>' +
      '<div class="d-flex gap-2 align-items-center flex-wrap">' +
        '<button type="button" class="btn btn-sm btn-outline-secondary" id="pinv-add-btn">+ Add row</button>' +
        '<button type="button" class="btn btn-sm btn-success" id="pinv-send-btn">Send Proposal Invites</button>' +
        '<span class="text-muted small" id="pinv-count-lbl"></span>' +
      '</div>' +
      '<div id="pinv-form-status" class="mt-2 small"></div>' +
      '</div>'
    );
  }

  function proposalInviteListHtml(): string {
    return (
      '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
        '<input type="search" class="form-control form-control-sm" id="pinv-search" placeholder="Search email / name…" style="max-width:260px" autocomplete="off">' +
        '<label class="form-label mb-0 small fw-semibold visually-hidden" for="pinv-filter">Filter status:</label>' +
        '<select class="form-select form-select-sm" id="pinv-filter" style="width:auto">' +
          '<option value="">All statuses</option>' +
          '<option value="sent" selected>Pending (sent)</option>' +
          '<option value="accepted">Accepted</option>' +
          '<option value="declined">Declined</option>' +
          '<option value="expired">Expired</option>' +
          '<option value="revoked">Revoked</option>' +
        '</select>' +
        '<button class="btn btn-sm btn-outline-secondary ms-auto" id="pinv-list-refresh">&circlearrowright; Refresh</button>' +
      '</div>' +
      '<div id="pinv-list-body">' + spinner() + '</div>' +
      '<div id="pinv-list-pager" class="mt-2"></div>'
    );
  }

  function syncProposalInviteCount(): void {
    const lbl = q("#pinv-count-lbl");
    if (!lbl) return;
    const count = _proposalInviteEntries.length > 0
      ? _proposalInviteEntries.length
      : document.querySelectorAll("#pinv-rows .inv-row").length;
    lbl.textContent = count > 0 ? `${count.toLocaleString()} row${count !== 1 ? "s" : ""}` : "";
  }

  function collectProposalInvites(): Array<{ email: string; firstName?: string; lastName?: string }> {
    if (_proposalInviteEntries.length > 0) return _proposalInviteEntries;
    const container = q("#pinv-rows");
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(".inv-row"))
      .map((row) => ({
        email: (row.querySelector<HTMLInputElement>("[data-pinv-email]")?.value ?? "").trim(),
        firstName: (row.querySelector<HTMLInputElement>("[data-pinv-first]")?.value ?? "").trim() || undefined,
        lastName: (row.querySelector<HTMLInputElement>("[data-pinv-last]")?.value ?? "").trim() || undefined,
      }))
      .filter((item) => item.email);
  }

  function renderProposalBulkSummary(entries: AdminInviteEntry[]): void {
    const container = q("#pinv-rows");
    if (!container) return;
    const preview = entries.slice(0, PROPOSAL_INVITE_BULK_THRESHOLD);
    const more = entries.length - preview.length;
    const rows = preview
      .map((e) => {
        return `<tr><td class="small">${esc(e.firstName || "—")}</td><td class="small">${esc(e.lastName || "—")}</td><td class="small mono">${esc(e.email)}</td></tr>`;
      })
      .join("");
    container.innerHTML =
      `<div class="d-flex align-items-center gap-2 rounded border px-3 py-2 mb-2 small bg-light">` +
      `<span><strong>${entries.length.toLocaleString()}</strong> invites loaded from CSV</span>` +
      `<button type="button" class="btn btn-sm btn-link p-0 text-danger ms-auto" id="pinv-clear-bulk">× Clear</button>` +
      `</div>` +
      `<table class="table table-sm mb-1"><thead><tr><th class="small">First name</th><th class="small">Last name</th><th class="small">Email</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>` +
      (more > 0 ? `<div class="small text-muted ps-1">\u2026and ${more.toLocaleString()} more</div>` : "");
    container.querySelector("#pinv-clear-bulk")?.addEventListener("click", () => clearProposalBulkImport());
  }

  function clearProposalBulkImport(): void {
    _proposalInviteEntries = [];
    const container = q("#pinv-rows");
    if (container) container.innerHTML = "";
    addProposalInviteRow();
    syncProposalInviteCount();
  }

  function makeProposalInviteRow(entry?: AdminInviteEntry): HTMLElement {
    const div = document.createElement("div");
    div.className = "inv-row d-flex gap-1 mb-1 align-items-center";
    div.innerHTML =
      `<input class="form-control form-control-sm" style="flex:1.2" type="text"
        placeholder="First (opt.)" data-pinv-first autocomplete="off"
        value="${esc(entry?.firstName ?? "")}">` +
      `<input class="form-control form-control-sm" style="flex:1.2" type="text"
        placeholder="Last (opt.)" data-pinv-last autocomplete="off"
        value="${esc(entry?.lastName ?? "")}">` +
      `<input class="form-control form-control-sm" style="flex:2" type="email"
        placeholder="email@example.com" data-pinv-email autocomplete="off"
        value="${esc(entry?.email ?? "")}">` +
      '<button type="button" class="btn btn-sm btn-outline-danger p-0 px-1 pinv-remove-btn"' +
      ' title="Remove row" style="flex:none;height:1.75rem;line-height:1">&times;</button>';
    div.querySelector<HTMLButtonElement>(".pinv-remove-btn")?.addEventListener("click", () => {
      div.remove();
      syncProposalInviteCount();
    });
    return div;
  }

  function addProposalInviteRow(entry?: AdminInviteEntry): void {
    const container = q("#pinv-rows");
    if (!container) return;
    if (container.querySelectorAll(".inv-row").length >= MAX_PROPOSAL_INVITES) return;
    container.appendChild(makeProposalInviteRow(entry));
    syncProposalInviteCount();
  }

  function addParsedProposalEntries(entries: AdminInviteEntry[]): void {
    if (entries.length > PROPOSAL_INVITE_BULK_THRESHOLD) {
      _proposalInviteEntries = entries;
      renderProposalBulkSummary(entries);
      syncProposalInviteCount();
      return;
    }
    const container = q("#pinv-rows");
    if (!container) return;
    const existingRows = Array.from(container.querySelectorAll<HTMLElement>(".inv-row"));
    let idx = 0;
    for (const row of existingRows) {
      if (idx >= entries.length) break;
      const emailEl = row.querySelector<HTMLInputElement>("[data-pinv-email]");
      if (emailEl && !emailEl.value.trim()) {
        const firstEl = row.querySelector<HTMLInputElement>("[data-pinv-first]");
        const lastEl = row.querySelector<HTMLInputElement>("[data-pinv-last]");
        if (firstEl) firstEl.value = entries[idx].firstName ?? "";
        if (lastEl) lastEl.value = entries[idx].lastName ?? "";
        emailEl.value = entries[idx].email;
        idx++;
      }
    }
    for (; idx < entries.length; idx++) addProposalInviteRow(entries[idx]);
    syncProposalInviteCount();
  }

  function wireProposalInviteForm(slug: string): void {
    const wrap = q<HTMLElement>("#admin-proposal-invite-wrap");
    if (!wrap || wrap.dataset.wiredProposalInvite === "1") return;
    wrap.dataset.wiredProposalInvite = "1";

    addProposalInviteRow();

    q("#pinv-parse-btn")?.addEventListener("click", () => {
      const text = q<HTMLTextAreaElement>("#pinv-paste")?.value ?? "";
      const { valid, skipped } = parseAdminInviteText(text);
      if (!valid.length) { toast(skipped > 0 ? `No valid email addresses found (${skipped} invalid)` : "No valid email addresses found in the pasted text", "error"); return; }
      addParsedProposalEntries(valid);
      const ta = q<HTMLTextAreaElement>("#pinv-paste");
      if (ta) ta.value = "";
      const skipMsg = skipped > 0 ? ` (${skipped} skipped — invalid email)` : "";
      toast(`Parsed ${valid.length} entr${valid.length !== 1 ? "ies" : "y"}${skipMsg}`, skipped > 0 ? "info" : "success");
    });

    q<HTMLInputElement>("#pinv-csv")?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string ?? "";
        const { valid, skipped } = parseAdminCsv(text);
        if (!valid.length) { toast("No valid rows found in CSV", "error"); return; }
        addParsedProposalEntries(valid);
        const skipMsg = skipped > 0 ? ` (${skipped} row${skipped !== 1 ? "s" : ""} skipped — invalid email)` : "";
        toast(`Imported ${valid.length} row${valid.length !== 1 ? "s" : ""} from CSV${skipMsg}`, skipped > 0 ? "info" : "success");
        (e.target as HTMLInputElement).value = "";
      };
      reader.readAsText(file);
    });

    q("#pinv-add-btn")?.addEventListener("click", () => addProposalInviteRow());
    q("#pinv-send-btn")?.addEventListener("click", () => void doAdminProposalInvite(slug));
  }

  async function doAdminProposalInvite(slug: string): Promise<void> {
    const statusEl = q("#pinv-form-status");

    const invites = collectProposalInvites();
    if (!invites.length) {
      if (statusEl) { statusEl.textContent = "No valid email addresses entered."; statusEl.className = "mt-2 small text-danger"; }
      return;
    }

    const sendBtn = q<HTMLButtonElement>("#pinv-send-btn");
    if (sendBtn) setButtonLoading(sendBtn);
    if (statusEl) { statusEl.textContent = ""; statusEl.className = "mt-2 small"; }

    try {
      const chunks: typeof invites[] = [];
      for (let i = 0; i < invites.length; i += PROPOSAL_INVITE_CHUNK_SIZE) {
        chunks.push(invites.slice(i, i + PROPOSAL_INVITE_CHUNK_SIZE));
      }

      let totalCreated = 0;
      let totalEndorsed = 0;
      let totalSkipped = 0;

      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1 && statusEl) {
          statusEl.textContent = `Sending batch ${i + 1} of ${chunks.length}…`;
          statusEl.className = "mt-2 small text-muted";
        }
        const r = await api<{ created?: unknown[]; endorsed?: unknown[]; skipped?: unknown[] }>(
          `/api/v1/admin/events/${slug}/invites/speakers/bulk`,
          { method: "POST", body: JSON.stringify({ invites: chunks[i] }) },
        );
        totalCreated  += r.created?.length  ?? 0;
        totalEndorsed += r.endorsed?.length ?? 0;
        totalSkipped  += r.skipped?.length  ?? 0;
      }

      const parts = [`✓ ${totalCreated} proposal invitation${totalCreated !== 1 ? "s" : ""} queued`];
      if (totalEndorsed) parts.push(`${totalEndorsed} already invited`);
      if (totalSkipped)  parts.push(`${totalSkipped} skipped`);
      toast(parts.join(" · "), "success");

      clearProposalBulkImport();
      if (statusEl) { statusEl.textContent = parts.join(" · "); statusEl.className = "mt-2 small text-success"; }
    } catch (err) {
      toast((err as Error).message, "error");
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "mt-2 small text-danger"; }
    } finally {
      if (sendBtn) resetButton(sendBtn);
    }
  }

  async function doResendEventInvite(slug: string, inviteId: string): Promise<void> {
    const statusEl = q(`#inv-resend-status-${inviteId}`);
    const resendBtn = document.querySelector<HTMLButtonElement>(`[data-resend-invite="${inviteId}"]`);

    if (resendBtn) setButtonLoading(resendBtn);

    try {
      await api(`/api/v1/admin/events/${slug}/invites/${inviteId}/resend`, { method: "POST", body: "{}" });
      if (statusEl) { statusEl.textContent = "Resent"; statusEl.className = "small text-success"; }
      toast("Invite resent", "success");
    } catch (err) {
      if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
      toast((err as Error).message, "error");
    } finally {
      if (resendBtn) resetButton(resendBtn);
    }
  }

  async function loadProposalInvites(slug: string, statusFilter?: string): Promise<void> {
    const body = q("#pinv-list-body");
    const pager = q("#pinv-list-pager");
    if (!body) return;
    body.innerHTML = spinner();
    if (pager) pager.innerHTML = "";

    const filterSel = q<HTMLSelectElement>("#pinv-filter");
    const searchInput = q<HTMLInputElement>("#pinv-search");
    const refreshBtn = q<HTMLButtonElement>("#pinv-list-refresh");

    const getFilter = (): string => filterSel?.value ?? (statusFilter ?? "sent");
    let offset = 0;
    let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

    const doLoad = async (): Promise<void> => {
      body.innerHTML = spinner();
      const filter = getFilter();
      const query = new URLSearchParams();
      query.set("type", "speaker");
      query.set("limit", String(pageSize));
      query.set("offset", String(offset));
      if (filter) query.set("status", filter);
      const searchVal = (searchInput?.value ?? "").trim();
      if (searchVal) query.set("q", searchVal);
      const url = `/api/v1/admin/events/${slug}/invites?${query.toString()}`;

      try {
        const d = await api<{ invites: InviteRecord[]; page?: { limit: number; offset: number; hasMore: boolean; total: number } }>(url);
        const invites = d.invites ?? [];
        body.innerHTML = tbl(
          ["Invitee Email", "Invitee Name", "Status", "Sent", "Declined", "Source", "Actions"],
          invites.map((i) => {
            const name = [i.invitee_first_name, i.invitee_last_name].filter(Boolean).join(" ") || "—";
            const canResend = i.status !== "accepted" && i.status !== "revoked";
            const action = canResend
              ? `<button class="btn btn-sm btn-outline-primary" data-resend-invite="${esc(i.id)}">Resend</button><div id="inv-resend-status-${esc(i.id)}" class="small mt-1"></div>`
              : '<span class="text-muted small">—</span>';
            return (
              `<tr><td class="mono" style="font-size:.8rem">${esc(i.invitee_email)}</td>` +
              `<td>${esc(name)}</td>` +
              `<td>${inviteBadge(i.status)}</td>` +
              `<td class="mono">${fmt(i.created_at)}</td>` +
              `<td class="mono">${i.declined_at ? fmt(i.declined_at) : "—"}</td>` +
              `<td class="text-muted small">${esc(i.source_type ?? "—")}</td>` +
              `<td>${action}</td></tr>`
            );
          }),
          "No proposal invites found matching the current filter",
        );

        body.querySelectorAll<HTMLButtonElement>("[data-resend-invite]").forEach((btn) => {
          btn.onclick = () => {
            const inviteId = btn.dataset.resendInvite;
            if (!inviteId) return;
            void doResendEventInvite(slug, inviteId);
          };
        });

        const pageOffset = d.page?.offset ?? offset;
        const pageLimit = d.page?.limit ?? pageSize;
        const hasMore = d.page?.hasMore ?? false;
        const pageTotal = d.page?.total ?? 0;
        const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

        if (pager) {
          pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, invites.length, pageTotal);
          pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
            offset = Math.max(0, pageOffset - pageLimit);
            void doLoad();
          });
          pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
            offset = pageOffset + pageLimit;
            void doLoad();
          });
          pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const page = Number(btn.dataset.pageJump || "1");
              if (!Number.isFinite(page) || page < 1) return;
              offset = (page - 1) * pageLimit;
              void doLoad();
            });
          });
          pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
            const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
            if (!Number.isFinite(nextSize) || nextSize < 1) return;
            pageSize = nextSize;
            offset = 0;
            void doLoad();
          });
        }
      } catch (err) {
        body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
        if (pager) pager.innerHTML = "";
      }
    };

    const bodyEl = body as HTMLElement;
    if (!bodyEl.dataset.proposalInvListWired) {
      bodyEl.dataset.proposalInvListWired = "1";
      searchInput?.addEventListener("input", () => { offset = 0; void doLoad(); });
      filterSel?.addEventListener("change", () => { offset = 0; void doLoad(); });
      refreshBtn?.addEventListener("click", () => { offset = 0; void doLoad(); });
    }

    await doLoad();
  }


  return { proposalInviteFormHtml, proposalInviteListHtml, wireProposalInviteForm, loadProposalInvites };
}
