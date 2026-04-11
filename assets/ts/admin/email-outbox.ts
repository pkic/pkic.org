import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { badge, esc, fmt, q, spinner, tbl, toast } from "./ui";
import type { AdminEmailOutboxRow, AdminEmailOutboxResponse, ApiFn } from "./types";
import type { StatsResponse } from "./reports";

export function emailOutboxSummaryBadges(items: Record<string, number>): string {
  const order = ["failed", "retrying", "queued", "sending", "sent", "transactional", "promotional"];
  const ordered = Object.entries(items).sort(([left], [right]) => {
    const leftRank = order.indexOf(left) === -1 ? order.length : order.indexOf(left);
    const rightRank = order.indexOf(right) === -1 ? order.length : order.indexOf(right);
    return leftRank - rightRank || left.localeCompare(right);
  });
  if (!ordered.length) {
    return '<span class="text-muted small">No matching rows</span>';
  }
  return ordered
    .map(([key, value]) => `${badge(key)} <span class="small text-muted me-3">${value}</span>`)
    .join("");
}

export function createEmailOutboxSection(api: ApiFn): {
  loadEmail: () => Promise<void>;
} {
  let _adminEmailOutboxState = {
    status: "",
    messageType: "",
    q: "",
    offset: 0,
    pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
  };
  const _adminEmailOutboxSelectedIds = new Set<string>();

  function isOutboxDueNow(row: AdminEmailOutboxRow): boolean {
    if (row.status !== "queued" && row.status !== "retrying") {
      return false;
    }
    return new Date(row.sendAfter).getTime() <= Date.now();
  }


  function renderEmailOutboxTable(rows: AdminEmailOutboxRow[]): string {
    return tbl(
      ["", "Recipient", "Message", "Queue", "Timing", "Details"],
      rows.map((row) => {
        const showFailureDetails = Boolean(row.lastError) && row.status !== "sent";
        const eventBits = [row.eventName, row.eventSlug ? `/${row.eventSlug}` : null].filter(Boolean);
        const subjectMeta = [
          `<span class="small text-muted">${esc(row.templateKey)}${row.templateVersion !== null ? ` v${row.templateVersion}` : ""}</span>`,
          badge(row.messageType),
          row.usesDirectBody ? '<span class="badge text-bg-light border text-dark">Direct body</span>' : "",
          row.hasCustomText ? '<span class="badge text-bg-light border text-dark">Custom text</span>' : "",
          row.bccRecipientCount > 0 ? `<span class="badge text-bg-light border text-dark">BCC ${row.bccRecipientCount}</span>` : "",
          row.hasCalendarInvite ? '<span class="badge text-bg-light border text-dark">Calendar</span>' : "",
          row.hasBadgeAttachment ? '<span class="badge text-bg-light border text-dark">Badge</span>' : "",
        ].filter(Boolean).join(" ");

        const queueMeta = [
          badge(row.status),
          `<span class="small text-muted">Attempts ${row.attempts}</span>`,
          `<span class="small text-muted">${esc(row.provider)}</span>`,
        ].join(" ");

        const timingLines = [
          `<div><span class="small text-muted">Queued</span><div class="mono small">${fmt(row.createdAt)}</div></div>`,
          `<div><span class="small text-muted">Due</span><div class="mono small">${fmt(row.sendAfter)}</div></div>`,
          `<div><span class="small text-muted">Sent</span><div class="mono small">${fmt(row.sentAt)}</div></div>`,
        ].join("");

        const detailLines = [
          `<div class="small text-muted">Outbox</div><div class="mono small">${esc(row.id)}</div>`,
          row.providerMessageId
            ? `<div class="small text-muted mt-2">Provider Message</div><div class="mono small">${esc(row.providerMessageId)}</div>`
            : "",
          showFailureDetails
            ? `<details class="mt-2"><summary class="small text-danger">Failure details</summary><div class="small text-danger mt-2">${esc(row.lastError)}</div></details>`
            : '<div class="small text-muted mt-2">No delivery error recorded.</div>',
        ].join("");

        return (
          "<tr>" +
            `<td><input class="form-check-input" type="checkbox" data-outbox-select="${esc(row.id)}"></td>` +
            `<td><div class="fw-semibold">${esc(row.recipientName || row.recipientEmail)}</div>` +
            `<div class="mono small text-muted">${esc(row.recipientEmail)}</div>` +
            (eventBits.length ? `<div class="small text-muted mt-1">${esc(eventBits.join(" | "))}</div>` : "") +
            "</td>" +
            `<td><div class="fw-semibold">${esc(row.subject || "PKI Consortium Update")}</div>` +
            `<div class="d-flex flex-wrap gap-1 mt-1">${subjectMeta}</div></td>` +
            `<td><div class="d-flex flex-wrap gap-1 align-items-center">${queueMeta}</div>` +
            `<div class="small text-muted mt-2">Updated ${esc(fmt(row.updatedAt))}</div></td>` +
            `<td>${timingLines}</td>` +
            `<td>${detailLines}</td>` +
          "</tr>"
        );
      }),
      "No outbox rows match the current filters",
    );
  }


  async function loadEmail(): Promise<void> {
    const el = q("#m-body");
    if (!el) return;
    el.innerHTML = spinner();
    _adminEmailOutboxSelectedIds.clear();
    try {
      const outboxQuery = new URLSearchParams({
        limit: String(_adminEmailOutboxState.pageSize),
        offset: String(_adminEmailOutboxState.offset),
      });
      if (_adminEmailOutboxState.status) outboxQuery.set("status", _adminEmailOutboxState.status);
      if (_adminEmailOutboxState.messageType) outboxQuery.set("messageType", _adminEmailOutboxState.messageType);
      if (_adminEmailOutboxState.q) outboxQuery.set("q", _adminEmailOutboxState.q);

      const [s, outboxData] = await Promise.all([
        api<StatsResponse>("/api/v1/admin/stats"),
        api<AdminEmailOutboxResponse>(`/api/v1/admin/email/outbox?${outboxQuery.toString()}`),
      ]);
      const ob = s.email.outboxByStatus;
      const currentPage = Math.floor(outboxData.page.offset / Math.max(1, outboxData.page.limit)) + 1;
      el.innerHTML =
        '<div class="stat-grid mb-4">' +
          Object.entries(ob)
            .map(
              ([k, v]) =>
                `<div class="stat-card${v > 0 && k === "failed" ? " danger" : ""}">` +
                `<div class="val">${v}</div><div class="lbl">${esc(k)}</div></div>`,
            )
            .join("") +
        "</div>" +
        '<div class="action-card mb-4">' +
          '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-start mb-3">' +
            '<div>' +
              '<strong>Email Outbox</strong>' +
              '<p class="mb-0 text-muted small">Inspect queued, retrying, sent, and failed email rows with recipient, subject, and delivery context.</p>' +
            '</div>' +
            '<div class="d-flex gap-2 flex-wrap">' +
              '<button class="btn btn-sm btn-outline-secondary" id="email-outbox-refresh">Refresh</button>' +
              '<button class="btn btn-sm btn-outline-secondary" id="email-outbox-clear">Clear filters</button>' +
            '</div>' +
          '</div>' +
          '<div class="row g-2 align-items-end mb-3">' +
            '<div class="col-md-3"><label class="form-label small fw-semibold mb-1">Status</label>' +
            `<select class="form-select form-select-sm" id="email-outbox-status">` +
              `<option value="">All statuses</option>` +
              `<option value="queued"${_adminEmailOutboxState.status === "queued" ? " selected" : ""}>Queued</option>` +
              `<option value="retrying"${_adminEmailOutboxState.status === "retrying" ? " selected" : ""}>Retrying</option>` +
              `<option value="sending"${_adminEmailOutboxState.status === "sending" ? " selected" : ""}>Sending</option>` +
              `<option value="sent"${_adminEmailOutboxState.status === "sent" ? " selected" : ""}>Sent</option>` +
              `<option value="failed"${_adminEmailOutboxState.status === "failed" ? " selected" : ""}>Failed</option>` +
            '</select></div>' +
            '<div class="col-md-3"><label class="form-label small fw-semibold mb-1">Message type</label>' +
            `<select class="form-select form-select-sm" id="email-outbox-type">` +
              `<option value="">All message types</option>` +
              `<option value="transactional"${_adminEmailOutboxState.messageType === "transactional" ? " selected" : ""}>Transactional</option>` +
              `<option value="promotional"${_adminEmailOutboxState.messageType === "promotional" ? " selected" : ""}>Promotional</option>` +
            '</select></div>' +
            '<div class="col-md-4"><label class="form-label small fw-semibold mb-1">Search</label>' +
            `<input type="search" class="form-control form-control-sm" id="email-outbox-search" value="${esc(_adminEmailOutboxState.q)}" placeholder="Recipient, subject, template, event, or error">` +
            '</div>' +
            '<div class="col-md-2 d-grid"><button class="btn btn-sm btn-primary" id="email-outbox-apply">Apply</button></div>' +
          '</div>' +
          '<div class="row g-3 mb-3">' +
            '<div class="col-md-6"><div class="border rounded p-3 h-100">' +
              '<div class="small text-muted mb-2">Status mix in current view</div>' +
              `<div class="d-flex flex-wrap gap-2">${emailOutboxSummaryBadges(outboxData.summary.byStatus)}</div>` +
            '</div></div>' +
            '<div class="col-md-6"><div class="border rounded p-3 h-100">' +
              '<div class="small text-muted mb-2">Message types, top templates, and due queue</div>' +
              `<div class="d-flex flex-wrap gap-2 mb-2">${emailOutboxSummaryBadges(outboxData.summary.byMessageType)}</div>` +
              '<div class="d-flex flex-wrap gap-2">' +
                (outboxData.summary.topTemplates.length
                  ? outboxData.summary.topTemplates.map((item) => `<span class="badge text-bg-light border text-dark">${esc(item.template_key)}: ${item.count}</span>`).join("")
                  : '<span class="text-muted small">No template usage in this view</span>') +
              '</div>' +
              `<div class="small text-muted mt-2">${emailOutboxSummaryBadges(outboxData.summary.dueByStatus)}</div>` +
            '</div></div>' +
          '</div>' +
          '<div class="border rounded p-3 mb-3 bg-light-subtle">' +
            '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-start">' +
              '<div>' +
                '<div class="small text-muted mb-1">Queue actions</div>' +
                `<div class="small" id="email-outbox-selection-status">Due now: ${outboxData.summary.dueNow}. Select visible rows to process due queued/retrying emails or reset failed ones.</div>` +
              '</div>' +
              '<div class="d-flex flex-wrap gap-2 align-items-end">' +
                '<div><label class="form-label small fw-semibold mb-1">Queue batch limit</label>' +
                '<input type="number" class="form-control form-control-sm" id="retry-limit" value="20" min="1" max="500" style="width:90px"></div>' +
                '<div class="form-check mt-4"><input class="form-check-input" type="checkbox" id="email-outbox-select-visible"><label class="form-check-label small" for="email-outbox-select-visible">Select visible</label></div>' +
                '<button class="btn btn-sm btn-success" id="btn-do-retry">Process due queue</button>' +
                '<button class="btn btn-sm btn-primary" id="btn-do-retry-all">Process all due</button>' +
                '<span class="small text-muted align-self-center" id="retry-all-status"></span>' +
                '<button class="btn btn-sm btn-outline-success" id="btn-do-retry-selected" disabled>Process selected</button>' +
                '<button class="btn btn-sm btn-outline-danger" id="btn-do-reset-selected" disabled>Reset selected failed</button>' +
                '<button class="btn btn-sm btn-danger" id="btn-do-reset-failed">Reset all failed</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          `<div id="email-outbox-table">${renderEmailOutboxTable(outboxData.outbox)}</div>` +
          `<div id="email-outbox-pager" class="mt-3">${pagerHtml(currentPage, outboxData.page.hasMore, outboxData.page.limit, outboxData.page.offset, outboxData.outbox.length, outboxData.page.total)}</div>` +
        '</div>';
        const applyOutboxFilters = (): void => {
          _adminEmailOutboxState.status = q<HTMLSelectElement>("#email-outbox-status")?.value ?? "";
          _adminEmailOutboxState.messageType = q<HTMLSelectElement>("#email-outbox-type")?.value ?? "";
          _adminEmailOutboxState.q = q<HTMLInputElement>("#email-outbox-search")?.value.trim() ?? "";
          _adminEmailOutboxState.offset = 0;
          void loadEmail();
        };

        const syncSelectionUi = (): void => {
          const visibleSelected = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id));
          const processableSelected = visibleSelected.filter((row) => isOutboxDueNow(row));
          const failedSelected = visibleSelected.filter((row) => row.status === "failed");
          const selectVisible = q<HTMLInputElement>("#email-outbox-select-visible");
          if (selectVisible) {
            selectVisible.checked = visibleSelected.length > 0 && visibleSelected.length === outboxData.outbox.length;
            selectVisible.indeterminate = visibleSelected.length > 0 && visibleSelected.length < outboxData.outbox.length;
          }
          const selectionStatus = q("#email-outbox-selection-status");
          if (selectionStatus) {
            selectionStatus.textContent =
              `${visibleSelected.length} visible row(s) selected. ` +
              `${processableSelected.length} can be processed now, ${failedSelected.length} can be reset from failed.`;
          }
          const retrySelectedBtn = q<HTMLButtonElement>("#btn-do-retry-selected");
          if (retrySelectedBtn) retrySelectedBtn.disabled = processableSelected.length === 0;
          const resetSelectedBtn = q<HTMLButtonElement>("#btn-do-reset-selected");
          if (resetSelectedBtn) resetSelectedBtn.disabled = failedSelected.length === 0;
        };

        q("#email-outbox-select-visible")?.addEventListener("change", (event) => {
          const checked = (event.currentTarget as HTMLInputElement).checked;
          outboxData.outbox.forEach((row) => {
            if (checked) {
              _adminEmailOutboxSelectedIds.add(row.id);
            } else {
              _adminEmailOutboxSelectedIds.delete(row.id);
            }
          });
          document.querySelectorAll<HTMLInputElement>("[data-outbox-select]").forEach((input) => {
            input.checked = checked;
          });
          syncSelectionUi();
        });
        document.querySelectorAll<HTMLInputElement>("[data-outbox-select]").forEach((input) => {
          input.addEventListener("change", () => {
            const id = input.dataset.outboxSelect ?? "";
            if (!id) return;
            if (input.checked) {
              _adminEmailOutboxSelectedIds.add(id);
            } else {
              _adminEmailOutboxSelectedIds.delete(id);
            }
            syncSelectionUi();
          });
        });
        syncSelectionUi();

        q("#email-outbox-refresh")?.addEventListener("click", () => void loadEmail());
        q("#email-outbox-clear")?.addEventListener("click", () => {
          _adminEmailOutboxState = {
            status: "",
            messageType: "",
            q: "",
            offset: 0,
            pageSize: ADMIN_LIST_PAGE_SIZE_DEFAULT,
          };
          void loadEmail();
        });
        q("#email-outbox-apply")?.addEventListener("click", applyOutboxFilters);
        q("#email-outbox-status")?.addEventListener("change", applyOutboxFilters);
        q("#email-outbox-type")?.addEventListener("change", applyOutboxFilters);
        q<HTMLInputElement>("#email-outbox-search")?.addEventListener("keydown", (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          applyOutboxFilters();
        });
        q("#email-outbox-pager [data-page-prev]")?.addEventListener("click", () => {
          _adminEmailOutboxState.offset = Math.max(0, outboxData.page.offset - outboxData.page.limit);
          void loadEmail();
        });
        q("#email-outbox-pager [data-page-next]")?.addEventListener("click", () => {
          _adminEmailOutboxState.offset = outboxData.page.offset + outboxData.page.limit;
          void loadEmail();
        });
        document.querySelectorAll<HTMLButtonElement>("#email-outbox-pager [data-page-jump]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const page = Number(btn.dataset.pageJump || "1");
            if (!Number.isFinite(page) || page < 1) return;
            _adminEmailOutboxState.offset = (page - 1) * outboxData.page.limit;
            void loadEmail();
          });
        });
        q<HTMLSelectElement>("#email-outbox-pager [data-page-size]")?.addEventListener("change", (event) => {
          const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
          if (!Number.isFinite(nextSize) || nextSize < 1) return;
          _adminEmailOutboxState.pageSize = nextSize;
          _adminEmailOutboxState.offset = 0;
          void loadEmail();
        });
        q("#btn-do-retry")?.addEventListener("click", () => void doRetry());
        q("#btn-do-retry-all")?.addEventListener("click", () => void doProcessAllDue());
        q("#btn-do-retry-selected")?.addEventListener("click", () => {
          const ids = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id) && isOutboxDueNow(row)).map((row) => row.id);
          void doRetry(ids);
        });
        q("#btn-do-reset-selected")?.addEventListener("click", () => {
          const ids = outboxData.outbox.filter((row) => _adminEmailOutboxSelectedIds.has(row.id) && row.status === "failed").map((row) => row.id);
          void doResetFailed(ids);
        });
        q("#btn-do-reset-failed")?.addEventListener("click", () => void doResetFailed());
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }


  async function doRetry(ids?: string[]): Promise<void> {
    const lim = parseInt(q<HTMLInputElement>("#retry-limit")?.value ?? "20") || 20;
    try {
      const r = await api<{ processed?: number; failed?: number; skipped?: number }>("/api/v1/internal/email/retry", {
        method: "POST",
        body: JSON.stringify(ids?.length ? { limit: ids.length, ids } : { limit: lim }),
      });
      const extra = ids?.length ? `, skipped ${r.skipped ?? 0}` : "";
      toast(`Processed ${r.processed ?? 0}, failed ${r.failed ?? 0}${extra}`, "success");
      await loadEmail();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }


  async function doProcessAllDue(): Promise<void> {
    const BATCH = 500;
    const btn = q<HTMLButtonElement>("#btn-do-retry-all");
    const statusEl = q("#retry-all-status");
    if (btn) { btn.disabled = true; btn.textContent = "Processing…"; }
    let totalProcessed = 0;
    let totalFailed = 0;
    try {
      while (true) {
        if (statusEl) statusEl.textContent = `${totalProcessed} sent so far…`;
        const r = await api<{ processed?: number; failed?: number }>("/api/v1/internal/email/retry", {
          method: "POST",
          body: JSON.stringify({ limit: BATCH }),
        });
        const processed = r.processed ?? 0;
        totalProcessed += processed;
        totalFailed += r.failed ?? 0;
        if (processed < BATCH) break; // queue exhausted
      }
      toast(`Done: ${totalProcessed} sent, ${totalFailed} failed`, "success");
      if (statusEl) statusEl.textContent = "";
      await loadEmail();
    } catch (err) {
      toast((err as Error).message, "error");
      if (statusEl) statusEl.textContent = "";
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Process all due"; }
    }
  }


  async function doResetFailed(ids?: string[]): Promise<void> {
    try {
      const r = await api<{ reset?: number; processed?: number }>("/api/v1/internal/email/reset-failed", {
        method: "POST",
        body: JSON.stringify(ids?.length ? { ids } : {}),
      });
      toast(`Reset ${r.reset ?? 0} failed, sent ${r.processed ?? 0}`, "success");
      await loadEmail();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  }

  return { loadEmail };
}
