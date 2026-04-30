import { useState, useEffect, useCallback } from "preact/hooks";
import { Badge } from "../../components/Badge";
import { Spinner } from "../../components/Spinner";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Pager } from "../../components/Pager";
import { DataTable } from "../../components/Table";
import { api } from "../api";
import { fmt, toast } from "../ui";
import type {
  AdminDueWorkRow,
  AdminDueWorkTab,
  AdminEmailOutboxResponse,
  AdminJobsRunResponse,
  AdminReminderPreviewRow,
} from "../types";

// ────────────────────────────────────────────────────────
// Data transformation helpers
// ────────────────────────────────────────────────────────

function collectDueWorkRows(
  result: AdminJobsRunResponse | null,
  dueOutboxRows: AdminEmailOutboxResponse["outbox"],
): AdminDueWorkRow[] {
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

  if (result) {
    const reminderSections: Array<{ label: string; rows: AdminReminderPreviewRow[] }> = [
      { label: "Attendee Invite", rows: result.reminders.preview.attendeeInvites },
      { label: "Speaker Invite", rows: result.reminders.preview.speakerInvites },
      { label: "Co-speaker Invite", rows: result.reminders.preview.coSpeakerInvites },
      { label: "Presentation Upload", rows: result.reminders.preview.presentationUploads },
      { label: "Registration Confirmation", rows: result.reminders.preview.registrationConfirmations },
    ];
    for (const section of reminderSections) {
      for (const row of section.rows) {
        rows.push({
          bucket: "reminders",
          typeLabel: section.label,
          title: row.recipientName || row.recipientEmail,
          subtitle: row.recipientName ? row.recipientEmail : null,
          context: [row.eventName, row.eventSlug, row.templateKey, `#${row.reminderNumber}`]
            .filter(Boolean)
            .join(" | "),
          detail: row.proposalTitle ? `${row.subject} | ${row.proposalTitle}` : row.subject,
          dueAt: row.dueAt,
          statusKey: "pending",
          statusLabel: "Preview",
        });
      }
    }
    for (const item of result.retention.preview.dueEvents) {
      rows.push({
        bucket: "cleanup",
        typeLabel: "Cleanup",
        title: item.eventName,
        subtitle: item.eventSlug,
        context: `${item.eligibleRegistrations} regs | ${item.eligibleUsers} users | ${item.retentionDays}d retention`,
        detail: item.endsAt ? `Event ended ${fmt(item.endsAt)}` : "Event end date unknown",
        dueAt: item.endsAt,
        statusKey: result.shouldRunRetention ? "waiting" : "secondary",
        statusLabel: result.shouldRunRetention ? "Eligible" : "Disabled",
      });
    }
  }

  return rows.sort((a, b) => {
    const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return at !== bt ? at - bt : a.title.localeCompare(b.title);
  });
}

// ────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────

const BUCKET_COLORS: Record<string, string> = { outbox: "primary", reminders: "info", cleanup: "warning" };

function DueWorkTable({ allRows, preview }: { allRows: AdminDueWorkRow[]; preview: AdminJobsRunResponse | null }) {
  const [tab, setTab] = useState<AdminDueWorkTab>("all");
  const [offset, setOffset] = useState(0);
  const pageSize = 25;

  const filteredRows = tab === "all" ? allRows : allRows.filter((r) => r.bucket === tab);
  const pagedRows = filteredRows.slice(offset, offset + pageSize);
  const currentPage = Math.floor(offset / pageSize) + 1;

  const counts = {
    all: allRows.length,
    outbox: allRows.filter((r) => r.bucket === "outbox").length,
    reminders: allRows.filter((r) => r.bucket === "reminders").length,
    cleanup: allRows.filter((r) => r.bucket === "cleanup").length,
  };

  const TABS: Array<{ key: AdminDueWorkTab; label: string }> = [
    { key: "all", label: "All" },
    { key: "outbox", label: "Outbox" },
    { key: "reminders", label: "Reminders" },
    { key: "cleanup", label: "Cleanup" },
  ];

  const emptyMsg =
    tab === "cleanup"
      ? preview?.shouldRunRetention
        ? "No cleanup candidates right now."
        : "Enable cleanup to preview retention candidates."
      : tab === "reminders"
        ? "No reminder candidates due right now."
        : tab === "outbox"
          ? "No due outbox rows right now."
          : "No due work items right now.";

  function handleTabChange(key: AdminDueWorkTab) {
    setTab(key);
    setOffset(0);
  }

  return (
    <div class="mt-4">
      <div class="d-flex flex-wrap gap-2 mb-3">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            class={`btn btn-sm ${key === tab ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => handleTabChange(key)}
          >
            {label}{" "}
            <span class={`badge ${key === tab ? "text-bg-light text-dark" : "text-bg-secondary"}`}>{counts[key]}</span>
          </button>
        ))}
      </div>
      <div class="border rounded p-3">
        <DataTable
          columns={[
            {
              header: "Type",
              cell: (row) => (
                <span class={`badge text-bg-${BUCKET_COLORS[row.bucket] ?? "secondary"}`}>{row.typeLabel}</span>
              ),
            },
            {
              header: "Target",
              cell: (row) => (
                <>
                  <div class="fw-semibold">{row.title}</div>
                  {row.subtitle && <div class="mono small text-muted">{row.subtitle}</div>}
                </>
              ),
            },
            {
              header: "Context",
              cell: (row) => (
                <>
                  <div class="small">{row.context}</div>
                  {row.detail && <div class="small text-muted mt-1">{row.detail}</div>}
                </>
              ),
            },
            { header: "Due", cell: (row) => fmt(row.dueAt), className: "small" },
            {
              header: "Status",
              cell: (row) =>
                row.bucket === "outbox" ? (
                  <Badge status={row.statusKey} />
                ) : (
                  <span class="badge text-bg-light border text-dark">{row.statusLabel}</span>
                ),
            },
          ]}
          data={pagedRows}
          empty={emptyMsg}
          className="align-middle"
        />
        <Pager
          page={currentPage}
          hasMore={offset + pagedRows.length < filteredRows.length}
          pageSize={pageSize}
          offset={offset}
          rowCount={pagedRows.length}
          total={filteredRows.length}
          onPrev={() => setOffset(Math.max(0, offset - pageSize))}
          onNext={() => setOffset(offset + pageSize)}
          onJump={(page) => setOffset((page - 1) * pageSize)}
          onPageSizeChange={() => void 0}
        />
      </div>
    </div>
  );
}

function JobRunSummary({
  result,
  title,
  empty,
}: {
  result: AdminJobsRunResponse | null;
  title: string;
  empty: string;
}) {
  if (!result) return <div class="small text-muted">{empty}</div>;

  const reminderVerb = result.dryRun ? "Queue" : "Queued";
  const outboxVerb = result.dryRun ? "Process" : "Processed";
  const retentionMsg = result.shouldRunRetention
    ? `Cleanup: ${result.retention.redactedUsers} users, ${result.retention.redactedRegistrations} regs, ${result.retention.affectedEvents} event(s).`
    : "Cleanup not included.";

  const reminderSections: Array<{ title: string; rows: AdminReminderPreviewRow[] }> = [
    { title: "Attendee Invites", rows: result.reminders.preview.attendeeInvites },
    { title: "Speaker Invites", rows: result.reminders.preview.speakerInvites },
    { title: "Co-speaker Invites", rows: result.reminders.preview.coSpeakerInvites },
    { title: "Presentation Uploads", rows: result.reminders.preview.presentationUploads },
    { title: "Registration Confirmations", rows: result.reminders.preview.registrationConfirmations },
  ].filter((s) => s.rows.length > 0);

  return (
    <div class="border rounded p-3">
      <div class="fw-semibold mb-2">{title}</div>
      <div class="small mb-2">
        {reminderVerb}: {result.reminders.processed} reminders ({result.reminders.inviteRemindersQueued} attendee,{" "}
        {result.reminders.speakerInviteRemindersQueued} speaker, {result.reminders.presentationRemindersQueued}{" "}
        presentation, {result.reminders.confirmationRemindersQueued} confirmation).
      </div>
      <div class="small mb-2">
        {outboxVerb}: {result.outbox.processed} outbox rows, {result.outbox.failed} failed.
      </div>
      <div class="small mb-2">{retentionMsg}</div>
      {result.retention.preview.dueEvents.length > 0 && (
        <details class="mt-3">
          <summary class="small fw-semibold">Cleanup candidates ({result.retention.preview.totalEvents})</summary>
          <div class="mt-2">
            <DataTable
              columns={[
                {
                  header: "Event",
                  cell: (item) => (
                    <>
                      <div class="fw-semibold">{item.eventName}</div>
                      <div class="small text-muted">{item.eventSlug}</div>
                    </>
                  ),
                },
                { header: "Ended", cell: (item) => fmt(item.endsAt), className: "small" },
                {
                  header: { label: "Retention", className: "text-end" },
                  cell: (item) => `${item.retentionDays} day(s)`,
                  className: "small text-end",
                },
                {
                  header: { label: "Regs", className: "text-end" },
                  cell: (item) => item.eligibleRegistrations,
                  className: "small mono text-end",
                },
                {
                  header: { label: "Users", className: "text-end" },
                  cell: (item) => item.eligibleUsers,
                  className: "small mono text-end",
                },
              ]}
              data={result.retention.preview.dueEvents.slice(0, 5)}
              empty="No cleanup candidates"
              rowKey={(item) => item.eventId}
            />
          </div>
          {result.retention.preview.dueEvents.length > 5 && (
            <div class="small text-muted mt-2">
              {result.retention.preview.dueEvents.length - 5} more event(s) eligible for cleanup.
            </div>
          )}
        </details>
      )}
      {reminderSections.map((section) => (
        <details key={section.title} class="mt-3">
          <summary class="small fw-semibold">
            {section.title} ({section.rows.length})
          </summary>
          <div class="mt-2">
            <DataTable
              columns={[
                {
                  header: "Recipient",
                  cell: (row) => (
                    <>
                      <div class="fw-semibold">{row.recipientName || row.recipientEmail}</div>
                      <div class="mono small text-muted">{row.recipientEmail}</div>
                    </>
                  ),
                },
                {
                  header: "Event / Template",
                  cell: (row) =>
                    [row.templateKey, `${row.eventName} (${row.eventSlug})`, `#${row.reminderNumber}`]
                      .filter(Boolean)
                      .join(" | "),
                  className: "small",
                },
                { header: "Subject", cell: (row) => row.subject, className: "small" },
              ]}
              data={section.rows.slice(0, 5)}
              empty="No candidates"
            />
          </div>
          {section.rows.length > 5 && (
            <div class="small text-muted mt-2">{section.rows.length - 5} more candidate(s).</div>
          )}
        </details>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Main section
// ────────────────────────────────────────────────────────

export function DueWork() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reminderLimit, setReminderLimit] = useState(120);
  const [outboxLimit, setOutboxLimit] = useState(120);
  const [includeRetention, setIncludeRetention] = useState(false);

  const [preview, setPreview] = useState<AdminJobsRunResponse | null>(null);
  const [lastRun, setLastRun] = useState<AdminJobsRunResponse | null>(null);
  const [dueOutboxRows, setDueOutboxRows] = useState<AdminEmailOutboxResponse["outbox"]>([]);

  const [running, setRunning] = useState(false);

  const fetchPreview = useCallback(
    async (rl: number, ol: number, retention: boolean): Promise<AdminJobsRunResponse> => {
      return api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          reminderLimit: rl,
          outboxLimit: ol,
          runReminders: true,
          runRetention: retention,
          runOutbox: true,
          runRetentionMode: "always",
          retentionHourUtc: 0,
          dryRun: true,
        }),
      });
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [, dueOutbox, previewResult] = await Promise.all([
        api<AdminEmailOutboxResponse>("/api/v1/admin/email/outbox?limit=1&offset=0"),
        api<AdminEmailOutboxResponse>(
          `/api/v1/admin/email/outbox?dueNow=true&limit=${Math.max(25, Math.min(outboxLimit, 100))}&offset=0`,
        ),
        fetchPreview(reminderLimit, outboxLimit, includeRetention),
      ]);
      setDueOutboxRows(dueOutbox.outbox);
      setPreview(previewResult);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reminderLimit, outboxLimit, includeRetention, fetchPreview]);

  useEffect(() => {
    void load();
  }, [load]);

  async function doRunJobs(dryRun: boolean) {
    setRunning(true);
    try {
      const result = await api<AdminJobsRunResponse>("/api/v1/internal/jobs/run", {
        method: "POST",
        body: JSON.stringify({
          reminderLimit,
          outboxLimit,
          runReminders: true,
          runRetention: includeRetention,
          runOutbox: true,
          runRetentionMode: "always",
          retentionHourUtc: 0,
          dryRun,
        }),
      });
      if (dryRun) {
        setPreview(result);
        toast("Preview refreshed", "info");
      } else {
        setLastRun(result);
        toast(
          `Done: ${result.reminders.processed} reminders, ${result.outbox.processed} outbox rows${includeRetention ? `, ${result.retention.redactedRegistrations} data redacted` : ""}`,
          "success",
        );
        void load();
      }
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setRunning(false);
    }
  }

  if (loading && !preview) return <Spinner />;
  if (error && !preview) return <ErrorAlert error={error} />;

  const allRows = collectDueWorkRows(preview, dueOutboxRows);

  return (
    <div>
      <div class="action-card">
        {/* Controls */}
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
          <strong>Due Work</strong>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm btn-outline-primary" onClick={() => void doRunJobs(true)} disabled={running}>
              Refresh Preview
            </button>
            <button class="btn btn-sm btn-primary" onClick={() => void doRunJobs(false)} disabled={running}>
              {running ? "Processing…" : "Process Due Work Now"}
            </button>
          </div>
        </div>

        {/* Settings */}
        <div class="border rounded p-2 mb-3 bg-light-subtle">
          <div class="d-flex flex-wrap align-items-center gap-3 small">
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Reminders</span>
              <input
                type="number"
                class="form-control form-control-sm"
                value={reminderLimit}
                min={1}
                max={500}
                onInput={(e) => setReminderLimit(Number((e.target as HTMLInputElement).value) || 120)}
                style="width:78px"
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Outbox</span>
              <input
                type="number"
                class="form-control form-control-sm"
                value={outboxLimit}
                min={1}
                max={500}
                onInput={(e) => setOutboxLimit(Number((e.target as HTMLInputElement).value) || 120)}
                style="width:78px"
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <input
                class="form-check-input mt-0"
                type="checkbox"
                checked={includeRetention}
                onChange={(e) => setIncludeRetention((e.target as HTMLInputElement).checked)}
              />
              <span class="text-muted">Cleanup</span>
            </label>
          </div>
        </div>

        {/* Due work table */}
        {loading ? <Spinner /> : <DueWorkTable allRows={allRows} preview={preview} />}

        {/* Last run summary */}
        <div class="mt-4">
          {lastRun ? (
            <details>
              <summary class="small fw-semibold">Last run summary</summary>
              <div class="mt-2">
                <JobRunSummary result={lastRun} title="Last Run" empty="" />
              </div>
            </details>
          ) : (
            <div class="small text-muted">No due-work run has been executed in this session yet.</div>
          )}
        </div>

        {preview && (
          <details class="mt-3">
            <summary class="small fw-semibold">Preview details</summary>
            <div class="mt-2">
              <JobRunSummary result={preview} title="Preview (Dry Run)" empty="No preview available." />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
