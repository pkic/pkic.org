import { pagerHtml } from "./pager";
import { badge, esc, fmt, q, spinner, tbl, toast } from "./ui";
import type { AdminDueWorkRow, AdminDueWorkTab, AdminEmailOutboxRow, AdminEmailOutboxResponse, AdminJobsRunResponse, AdminReminderPreviewRow, ApiFn } from "./types";
import { emailOutboxSummaryBadges } from "./email-outbox";

export function createJobsSection(
  api: ApiFn,
  deps: { loadEmail: () => Promise<void> },
): {
  loadDueWork: () => Promise<void>;
} {
  const { loadEmail } = deps;

  let _adminJobsPreview: AdminJobsRunResponse | null = null;
  let _adminJobsLastRun: AdminJobsRunResponse | null = null;
  let _adminJobsState = {
    reminderLimit: 120,
    outboxLimit: 120,
    runRetention: false,
  };
  let _adminDueOutboxRows: AdminEmailOutboxRow[] = [];
  let _adminDueWorkViewState: { tab: AdminDueWorkTab; pageSize: number; offset: number } = {
    tab: "all",
    pageSize: 25,
    offset: 0,
  };

  function renderJobsRunSummary(title: string, result: AdminJobsRunResponse | null, empty: string): string {
    if (!result) {
      return `<div class="small text-muted">${esc(empty)}</div>`;
    }

    const reminderVerb = result.dryRun ? "Queue" : "Queued";
    const outboxVerb = result.dryRun ? "Process" : "Processed";
    const cleanupVerb = result.dryRun ? "Cleanup" : "Cleanup";
    const retentionCounts = result.shouldRunRetention
      ? `${cleanupVerb}: ${result.retention.redactedUsers} users, ${result.retention.redactedRegistrations} registrations, ${result.retention.affectedEvents} event(s).`
      : "Cleanup not included.";
    const retentionDetails = result.retention.preview.dueEvents.length > 0
      ? (
        `<details class="mt-3">` +
          `<summary class="small fw-semibold">Cleanup candidates (${result.retention.preview.totalEvents})</summary>` +
          `<div class="mt-2">` +
            tbl(
              ["Event", "Ended", "Retention", "Registrations", "Users"],
              result.retention.preview.dueEvents.slice(0, 5).map((item) => (
                `<tr>` +
                  `<td><div class="fw-semibold">${esc(item.eventName)}</div><div class="small text-muted">${esc(item.eventSlug)}</div></td>` +
                  `<td class="small">${esc(fmt(item.endsAt))}</td>` +
                  `<td class="small">${item.retentionDays} day(s)</td>` +
                  `<td class="small">${item.eligibleRegistrations}</td>` +
                  `<td class="small">${item.eligibleUsers}</td>` +
                `</tr>`
              )),
              "No cleanup candidates",
            ) +
          `</div>` +
          (result.retention.preview.dueEvents.length > 5
            ? `<div class="small text-muted mt-2">${result.retention.preview.dueEvents.length - 5} more event(s) eligible for cleanup.</div>`
            : "") +
        `</details>`
      )
      : (result.shouldRunRetention
        ? '<div class="small text-muted mt-2">No events are currently past their retention window.</div>'
        : "");
    const reminderSections: Array<{ title: string; rows: AdminReminderPreviewRow[] }> = [
      { title: "Attendee Invites", rows: result.reminders.preview.attendeeInvites },
      { title: "Speaker Invites", rows: result.reminders.preview.speakerInvites },
      { title: "Co-speaker Invites", rows: result.reminders.preview.coSpeakerInvites },
      { title: "Presentation Uploads", rows: result.reminders.preview.presentationUploads },
    ];
    const reminderDetails = reminderSections
      .filter((section) => section.rows.length > 0)
      .map((section) => {
        const sampleRows = section.rows.slice(0, 5).map((row) => {
            const summaryBits = [row.templateKey, `${row.eventName} (${row.eventSlug})`, `#${row.reminderNumber}`];
            if (row.proposalTitle) summaryBits.push(row.proposalTitle);
            return (
              `<tr>` +
                `<td><div class="fw-semibold">${esc(row.recipientName || row.recipientEmail)}</div><div class="mono small text-muted">${esc(row.recipientEmail)}</div></td>` +
                `<td><div class="small">${esc(summaryBits.join(" | "))}</div><div class="small text-muted">Due ${esc(fmt(row.dueAt))}</div></td>` +
                `<td class="small">${esc(row.subject)}</td>` +
              `</tr>`
            );
          });
        const extra = section.rows.length > 5
          ? `<div class="small text-muted mt-2">${section.rows.length - 5} more candidate(s) in this category.</div>`
          : "";
        return (
          `<details class="mt-3">` +
            `<summary class="small fw-semibold">${esc(section.title)} (${section.rows.length})</summary>` +
            `<div class="mt-2">${tbl(["Recipient", "Event / Template", "Subject"], sampleRows, "No candidates")}</div>` +
            extra +
          `</details>`
        );
      })
      .join("");

    return (
      `<div class="border rounded p-3">` +
        `<div class="fw-semibold mb-2">${esc(title)}</div>` +
        `<div class="small mb-2">${reminderVerb}: ${result.reminders.processed} reminders ` +
          `(${result.reminders.inviteRemindersQueued} attendee, ${result.reminders.speakerInviteRemindersQueued} speaker, ${result.reminders.presentationRemindersQueued} presentation).</div>` +
        `<div class="small mb-2">${outboxVerb}: ${result.outbox.processed} outbox rows, ${result.outbox.failed} failed.</div>` +
        `<div class="small mb-2">${retentionCounts}</div>` +
        `<div class="small text-muted">Queue mix: ${emailOutboxSummaryBadges(result.outbox.dueByStatus)}</div>` +
        retentionDetails +
        reminderDetails +
      `</div>`
    );
  }


  function dueWorkTypeBadge(typeLabel: string, bucket: AdminDueWorkRow["bucket"]): string {
    const color = bucket === "outbox" ? "primary" : bucket === "reminders" ? "info" : "warning";
    return `<span class="badge text-bg-${color}">${esc(typeLabel)}</span>`;
  }

  function collectDueWorkRows(result: AdminJobsRunResponse | null, dueOutboxRows: AdminEmailOutboxRow[]): AdminDueWorkRow[] {
    const rows: AdminDueWorkRow[] = dueOutboxRows.map((row) => ({
      bucket: "outbox",
      typeLabel: "Email Queue",
      title: row.recipientName || row.recipientEmail,
      subtitle: row.recipientName ? row.recipientEmail : null,
      context: [row.eventName, row.templateKey, `Attempts ${row.attempts}`].filter(Boolean).join(" | "),
      detail: row.subject,
      dueAt: row.sendAfter,
      statusKey: row.status,
      statusLabel: row.status,
    }));

    const reminderSections: Array<{ label: string; rows: AdminReminderPreviewRow[] }> = result
      ? [
        { label: "Attendee Invite", rows: result.reminders.preview.attendeeInvites },
        { label: "Speaker Invite", rows: result.reminders.preview.speakerInvites },
        { label: "Co-speaker Invite", rows: result.reminders.preview.coSpeakerInvites },
        { label: "Presentation Upload", rows: result.reminders.preview.presentationUploads },
      ]
      : [];

    for (const section of reminderSections) {
      for (const row of section.rows) {
        rows.push({
          bucket: "reminders",
          typeLabel: section.label,
          title: row.recipientName || row.recipientEmail,
          subtitle: row.recipientName ? row.recipientEmail : null,
          context: [row.eventName, row.eventSlug, row.templateKey, `#${row.reminderNumber}`].filter(Boolean).join(" | "),
          detail: row.proposalTitle ? `${row.subject} | ${row.proposalTitle}` : row.subject,
          dueAt: row.dueAt,
          statusKey: "pending",
          statusLabel: "Preview",
        });
      }
    }

    if (result) {
      for (const item of result.retention.preview.dueEvents) {
        rows.push({
          bucket: "cleanup",
          typeLabel: "Cleanup",
          title: item.eventName,
          subtitle: item.eventSlug,
          context: `${item.eligibleRegistrations} registrations | ${item.eligibleUsers} users | ${item.retentionDays} day retention`,
          detail: item.endsAt ? `Event ended ${fmt(item.endsAt)}` : "Event end date unknown",
          dueAt: item.endsAt,
          statusKey: result.shouldRunRetention ? "waiting" : "secondary",
          statusLabel: result.shouldRunRetention ? "Eligible" : "Disabled",
        });
      }
    }

    return rows.sort((left, right) => {
      const leftTime = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightTime = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return left.title.localeCompare(right.title);
    });
  }


  function renderDueWorkMergedTable(result: AdminJobsRunResponse | null, dueOutboxRows: AdminEmailOutboxRow[]): string {
    const allRows = collectDueWorkRows(result, dueOutboxRows);
    const counts = {
      all: allRows.length,
      outbox: allRows.filter((row) => row.bucket === "outbox").length,
      reminders: allRows.filter((row) => row.bucket === "reminders").length,
      cleanup: allRows.filter((row) => row.bucket === "cleanup").length,
    };
    const tab = _adminDueWorkViewState.tab;
    const filteredRows = tab === "all" ? allRows : allRows.filter((row) => row.bucket === tab);
    const offset = Math.min(_adminDueWorkViewState.offset, Math.max(0, filteredRows.length - 1));
    const pageSize = Math.max(1, _adminDueWorkViewState.pageSize);
    const pagedRows = filteredRows.slice(offset, offset + pageSize);
    const currentPage = Math.floor(offset / pageSize) + 1;
    const tabs: Array<{ key: AdminDueWorkTab; label: string; count: number }> = [
      { key: "all", label: "All", count: counts.all },
      { key: "outbox", label: "Outbox", count: counts.outbox },
      { key: "reminders", label: "Reminders", count: counts.reminders },
      { key: "cleanup", label: "Cleanup", count: counts.cleanup },
    ];

    return (
      '<div class="mt-4">' +
        '<div class="d-flex flex-wrap gap-2 mb-3" id="duework-tabs">' +
          tabs.map((item) => (
            `<button type="button" class="btn btn-sm ${item.key === tab ? "btn-primary" : "btn-outline-secondary"}" data-duework-tab="${item.key}">` +
              `${esc(item.label)} <span class="badge ${item.key === tab ? "text-bg-light text-dark" : "text-bg-secondary"}">${item.count}</span>` +
            `</button>`
          )).join("") +
        '</div>' +
        '<div class="border rounded p-3">' +
          tbl(
            ["Type", "Target", "Context", "Due", "Status"],
            pagedRows.map((row) => (
              `<tr>` +
                `<td>${dueWorkTypeBadge(row.typeLabel, row.bucket)}</td>` +
                `<td><div class="fw-semibold">${esc(row.title)}</div>${row.subtitle ? `<div class="mono small text-muted">${esc(row.subtitle)}</div>` : ""}</td>` +
                `<td><div class="small">${esc(row.context)}</div>${row.detail ? `<div class="small text-muted mt-1">${esc(row.detail)}</div>` : ""}</td>` +
                `<td class="small">${esc(fmt(row.dueAt))}</td>` +
                `<td><div>${row.bucket === "outbox" ? badge(row.statusKey) : `<span class="badge text-bg-light border text-dark">${esc(row.statusLabel)}</span>`}</div></td>` +
              `</tr>`
            )),
            tab === "cleanup"
              ? (result?.shouldRunRetention ? "No cleanup candidates right now." : "Enable cleanup to preview retention candidates.")
              : tab === "reminders"
                ? "No reminder candidates due right now."
                : tab === "outbox"
                  ? "No due outbox rows right now."
                  : "No due work items right now.",
          ) +
          `<div class="mt-3" id="duework-pager">${pagerHtml(currentPage, offset + pagedRows.length < filteredRows.length, pageSize, offset, pagedRows.length, filteredRows.length)}</div>` +
        '</div>' +
      '</div>'
    );
  }


  function syncJobsStateFromInputs(): void {
    const reminderLimit = parseInt(q<HTMLInputElement>("#jobs-reminder-limit")?.value ?? String(_adminJobsState.reminderLimit), 10) || 120;
    const outboxLimit = parseInt(q<HTMLInputElement>("#jobs-outbox-limit")?.value ?? String(_adminJobsState.outboxLimit), 10) || 120;
    const runRetention = Boolean(q<HTMLInputElement>("#jobs-include-retention")?.checked ?? _adminJobsState.runRetention);
    _adminJobsState = { reminderLimit, outboxLimit, runRetention };
  }


  async function fetchDueWorkPreview(): Promise<AdminJobsRunResponse> {
    return api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
      method: "POST",
      body: JSON.stringify({
        reminderLimit: _adminJobsState.reminderLimit,
        outboxLimit: _adminJobsState.outboxLimit,
        runReminders: true,
        runRetention: _adminJobsState.runRetention,
        runOutbox: true,
        runRetentionMode: "always",
        retentionHourUtc: 0,
        dryRun: true,
      }),
    });
  }


  function renderDueWorkControl(
    summary: Pick<AdminEmailOutboxResponse["summary"], "dueNow" | "dueByStatus" | "nextSendAfter">,
    dueOutboxRows: AdminEmailOutboxRow[],
  ): string {
    const lastRunBlock = _adminJobsLastRun
      ? (
        '<details class="mt-3">' +
          '<summary class="small fw-semibold">Last run summary</summary>' +
          `<div class="mt-2">${renderJobsRunSummary("Last Run", _adminJobsLastRun, "")}</div>` +
        '</details>'
      )
      : '<div class="small text-muted mt-3">No due-work run has been executed in this session yet.</div>';

    return (
      '<div class="action-card">' +
        '<div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">' +
          '<strong>Due Work</strong>' +
          '<div class="d-flex gap-2 flex-wrap">' +
            '<button class="btn btn-sm btn-outline-primary" id="btn-preview-jobs">Refresh Preview</button>' +
            '<button class="btn btn-sm btn-primary" id="btn-run-jobs">Process Due Work Now</button>' +
          '</div>' +
        '</div>' +
        '<div class="border rounded p-2 mb-3 bg-light-subtle">' +
          '<div class="d-flex flex-wrap align-items-center gap-3 small">' +
            '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
              '<span class="text-muted">Reminders</span>' +
              `<input type="number" class="form-control form-control-sm" id="jobs-reminder-limit" value="${_adminJobsState.reminderLimit}" min="1" max="500" style="width:78px">` +
            '</label>' +
            '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
              '<span class="text-muted">Outbox</span>' +
              `<input type="number" class="form-control form-control-sm" id="jobs-outbox-limit" value="${_adminJobsState.outboxLimit}" min="1" max="500" style="width:78px">` +
            '</label>' +
            '<label class="d-inline-flex align-items-center gap-2 mb-0">' +
              `<input class="form-check-input mt-0" type="checkbox" id="jobs-include-retention"${_adminJobsState.runRetention ? " checked" : ""}>` +
              '<span class="text-muted">Cleanup</span>' +
            '</label>' +
          '</div>' +
        '</div>' +
        `<div id="duework-items-panel">${renderDueWorkMergedTable(_adminJobsPreview, dueOutboxRows)}</div>` +
        '<div class="small text-muted mt-3" id="jobs-run-status"></div>' +
        lastRunBlock +
      '</div>'
    );
  }


  function wireDueWorkItemsControls(): void {
    document.querySelectorAll<HTMLButtonElement>("#duework-tabs [data-duework-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = (btn.dataset.dueworkTab ?? "all") as AdminDueWorkTab;
        _adminDueWorkViewState.tab = tab;
        _adminDueWorkViewState.offset = 0;
        const panel = q("#duework-items-panel");
        if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
        wireDueWorkItemsControls();
      });
    });

    q("#duework-pager [data-page-prev]")?.addEventListener("click", () => {
      _adminDueWorkViewState.offset = Math.max(0, _adminDueWorkViewState.offset - _adminDueWorkViewState.pageSize);
      const panel = q("#duework-items-panel");
      if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
      wireDueWorkItemsControls();
    });
    q("#duework-pager [data-page-next]")?.addEventListener("click", () => {
      _adminDueWorkViewState.offset += _adminDueWorkViewState.pageSize;
      const panel = q("#duework-items-panel");
      if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
      wireDueWorkItemsControls();
    });
    document.querySelectorAll<HTMLButtonElement>("#duework-pager [data-page-jump]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const page = Number(btn.dataset.pageJump || "1");
        if (!Number.isFinite(page) || page < 1) return;
        _adminDueWorkViewState.offset = (page - 1) * _adminDueWorkViewState.pageSize;
        const panel = q("#duework-items-panel");
        if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
        wireDueWorkItemsControls();
      });
    });
    q<HTMLSelectElement>("#duework-pager [data-page-size]")?.addEventListener("change", (event) => {
      const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
      if (!Number.isFinite(nextSize) || nextSize < 1) return;
      _adminDueWorkViewState.pageSize = nextSize;
      _adminDueWorkViewState.offset = 0;
      const panel = q("#duework-items-panel");
      if (panel) panel.innerHTML = renderDueWorkMergedTable(_adminJobsPreview, _adminDueOutboxRows);
      wireDueWorkItemsControls();
    });
  }


  function wireDueWorkControls(): void {
    q("#jobs-reminder-limit")?.addEventListener("change", syncJobsStateFromInputs);
    q("#jobs-outbox-limit")?.addEventListener("change", syncJobsStateFromInputs);
    q("#jobs-include-retention")?.addEventListener("change", syncJobsStateFromInputs);
    q("#btn-preview-jobs")?.addEventListener("click", () => void doRunJobs(true));
    q("#btn-run-jobs")?.addEventListener("click", () => void doRunJobs(false));
    wireDueWorkItemsControls();
  }


  async function loadDueWork(): Promise<void> {
    const el = q("#w-body");
    if (!el) return;
    syncJobsStateFromInputs();
    el.innerHTML = spinner();
    try {
      const [outboxData, dueOutboxData, preview] = await Promise.all([
        api<AdminEmailOutboxResponse>("/api/v1/admin/email/outbox?limit=1&offset=0"),
        api<AdminEmailOutboxResponse>(`/api/v1/admin/email/outbox?dueNow=true&limit=${Math.max(25, Math.min(_adminJobsState.outboxLimit, 100))}&offset=0`),
        fetchDueWorkPreview(),
      ]);
      _adminJobsPreview = preview;
      _adminDueOutboxRows = dueOutboxData.outbox;
      el.innerHTML = renderDueWorkControl(outboxData.summary, dueOutboxData.outbox);
      wireDueWorkControls();
    } catch (err) {
      el.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }


  async function doRunJobs(dryRun: boolean): Promise<void> {
    const btn = q<HTMLButtonElement>(dryRun ? "#btn-preview-jobs" : "#btn-run-jobs");
    const statusEl = q("#jobs-run-status");

    syncJobsStateFromInputs();
    const reminderLimit = _adminJobsState.reminderLimit;
    const outboxLimit = _adminJobsState.outboxLimit;
    const runReminders = true;
    const runOutbox = true;
    const runRetention = _adminJobsState.runRetention;

    if (btn) { btn.disabled = true; btn.textContent = dryRun ? "Refreshing..." : "Processing..."; }
    if (statusEl) statusEl.textContent = dryRun ? "Previewing due work..." : "Processing due reminders and outbox...";

    try {
      const result = await api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          reminderLimit,
          outboxLimit,
          runReminders,
          runRetention,
          runOutbox,
          runRetentionMode: "always",
          retentionHourUtc: 0,
          dryRun,
        }),
      });

      if (dryRun) {
        _adminJobsPreview = result;
      } else {
        _adminJobsLastRun = result;
      }
      const retentionState = runRetention
        ? (result.shouldRunRetention ? (dryRun ? "would run" : "ran") : (dryRun ? "would skip" : "skipped"))
        : "not requested";
      const msg = dryRun
        ? `Preview: ${result.reminders.processed} reminders, ${result.outbox.dueNow} outbox rows due now, cleanup ${retentionState}.`
        : `Processed ${result.reminders.processed} reminders, ${result.outbox.processed} outbox rows, ${result.outbox.failed} outbox failures, cleanup ${retentionState}.`;
      toast(msg, "success");
      if (statusEl) statusEl.textContent = msg;
      await Promise.all([loadDueWork(), loadEmail()]);
    } catch (err) {
      const msg = (err as Error).message;
      toast(msg, "error");
      if (statusEl) statusEl.textContent = msg;
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = dryRun ? "Refresh Preview" : "Process Due Work Now"; }
    }
  }


  return { loadDueWork };
}
