import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { badge, esc, fmt, q, spinner, tbl, toast } from "./ui";
import type { AdminDueWorkRow, AdminDueWorkTab, AdminEmailOutboxResponse, AdminEmailOutboxRow, AdminJobsRunResponse, AdminReminderPreviewRow, ApiFn } from "./types";
import type { StatsResponse } from "./reports";

export function createDueWorkSection(api: ApiFn): {
  loadDueWork: () => Promise<void>;
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

  function isOutboxDueNow(row: AdminEmailOutboxRow): boolean {
    if (row.status !== "queued" && row.status !== "retrying") {
      return false;
    }
    return new Date(row.sendAfter).getTime() <= Date.now();
  }

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

  function emailOutboxSummaryBadges(items: Record<string, number>): string {
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

  return { loadDueWork, loadEmail };
}
