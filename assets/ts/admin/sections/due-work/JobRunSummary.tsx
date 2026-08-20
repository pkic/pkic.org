import type { AdminJobsRunResponse, AdminReminderPreviewRow } from "../../types";
import { fmt } from "../../ui";
import { DataTable } from "../../../components/Table";

export function JobRunSummary({
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
  ].filter((section) => section.rows.length > 0);

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
