import { all } from "../db/queries";
import { getConfig } from "../config";
import { runReminderCycle } from "./reminders";
import { summarizeRetentionJob } from "./retention";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type { AdminDueWorkRow, AdminDueWorkTab } from "../../../assets/shared/schemas/admin-due-work";
import type { DatabaseLike, Env } from "../types";

interface DueOutboxRow {
  recipient_email: string;
  recipient_name: string | null;
  event_name: string | null;
  template_key: string;
  subject: string | null;
  attempts: number;
  send_after: string;
  status: string;
}

interface DueWorkListOptions {
  bucket: AdminDueWorkTab;
  includeRetention: boolean;
  reminderLimit: number;
  outboxLimit: number;
  limit: number;
  offset: number;
  q?: string;
  sort?: string;
}

async function listDueOutbox(db: DatabaseLike, limit: number): Promise<DueOutboxRow[]> {
  return all<DueOutboxRow>(
    db,
    `SELECT o.recipient_email,
            NULLIF(TRIM(COALESCE(json_extract(o.payload_json, '$.firstName'), '') || ' ' ||
                         COALESCE(json_extract(o.payload_json, '$.lastName'), '')), '') AS recipient_name,
            COALESCE(e.name, json_extract(o.payload_json, '$.eventName')) AS event_name,
            o.template_key, o.subject, o.attempts, o.send_after, o.status
     FROM email_outbox o
     LEFT JOIN events e ON e.id = o.event_id
     WHERE o.status IN ('queued', 'retrying') AND o.send_after <= ?
     ORDER BY o.send_after ASC, o.id ASC
     LIMIT ?`,
    [new Date().toISOString(), limit],
  );
}

function compareRows(sort: string | undefined): (left: AdminDueWorkRow, right: AdminDueWorkRow) => number {
  const descending = sort?.startsWith("-") ?? false;
  const field = (descending ? sort?.slice(1) : sort) ?? "dueAt";
  const direction = descending ? -1 : 1;

  return (left, right) => {
    const leftValue = field === "dueAt" ? (left.dueAt ?? "9999") : String(left[field as "title" | "typeLabel"]);
    const rightValue = field === "dueAt" ? (right.dueAt ?? "9999") : String(right[field as "title" | "typeLabel"]);
    const compared = leftValue.localeCompare(rightValue);
    return (compared || left.title.localeCompare(right.title) || left.context.localeCompare(right.context)) * direction;
  };
}

export async function listDueWork(db: DatabaseLike, env: Env, appBaseUrl: string, options: DueWorkListOptions) {
  const config = getConfig({ ...env, APP_BASE_URL: appBaseUrl });
  const [outbox, reminders, retention] = await Promise.all([
    listDueOutbox(db, options.outboxLimit),
    runReminderCycle(db, {
      appBaseUrl,
      reminderIntervalDays: config.reminderIntervalDays,
      pendingConfirmationReminderIntervalDays: config.pendingConfirmationReminderIntervalDays,
      confirmationLinkTtlHours: config.confirmationLinkTtlHours,
      maxInviteReminders: config.maxInviteReminders,
      maxPendingConfirmationReminders: config.maxPendingConfirmationReminders,
      maxPresentationReminders: config.maxPresentationReminders,
      presentationReminderLeadDays: config.presentationReminderLeadDays,
      limit: options.reminderLimit,
      dryRun: true,
    }),
    options.includeRetention ? summarizeRetentionJob(db) : Promise.resolve({ dueEvents: [] }),
  ]);

  const rows: AdminDueWorkRow[] = outbox.map((row) => ({
    bucket: "outbox",
    typeLabel: "Email Queue",
    title: row.recipient_name || row.recipient_email,
    subtitle: row.recipient_name ? row.recipient_email : null,
    context: [row.event_name, row.template_key, `Attempts ${row.attempts}`].filter(Boolean).join(" | "),
    detail: row.subject,
    dueAt: row.send_after,
    statusKey: row.status,
    statusLabel: row.status,
  }));

  const reminderSections = [
    ["Attendee Invite", reminders.preview.attendeeInvites],
    ["Speaker Invite", reminders.preview.speakerInvites],
    ["Co-speaker Invite", reminders.preview.coSpeakerInvites],
    ["Presentation Upload", reminders.preview.presentationUploads],
    ["Registration Confirmation", reminders.preview.registrationConfirmations],
  ] as const;
  for (const [typeLabel, candidates] of reminderSections) {
    for (const candidate of candidates) {
      rows.push({
        bucket: "reminders",
        typeLabel,
        title: candidate.recipientName || candidate.recipientEmail,
        subtitle: candidate.recipientName ? candidate.recipientEmail : null,
        context: [candidate.eventName, candidate.eventSlug, candidate.templateKey, `#${candidate.reminderNumber}`]
          .filter(Boolean)
          .join(" | "),
        detail: candidate.proposalTitle ? `${candidate.subject} | ${candidate.proposalTitle}` : candidate.subject,
        dueAt: candidate.dueAt,
        statusKey: "pending",
        statusLabel: "Preview",
      });
    }
  }

  for (const item of retention.dueEvents) {
    rows.push({
      bucket: "cleanup",
      typeLabel: "Cleanup",
      title: item.eventName,
      subtitle: item.eventSlug,
      context: `${item.eligibleRegistrations} regs | ${item.eligibleUsers} users | ${item.retentionDays}d retention`,
      detail: `Event ended ${item.endsAt}`,
      dueAt: item.endsAt,
      statusKey: "waiting",
      statusLabel: "Eligible",
    });
  }

  const normalizedQuery = options.q?.toLocaleLowerCase() ?? "";
  const searched = normalizedQuery
    ? rows.filter((row) =>
        [row.typeLabel, row.title, row.subtitle, row.context, row.detail]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalizedQuery)),
      )
    : rows;
  const counts = {
    all: searched.length,
    outbox: searched.filter((row) => row.bucket === "outbox").length,
    reminders: searched.filter((row) => row.bucket === "reminders").length,
    cleanup: searched.filter((row) => row.bucket === "cleanup").length,
  };
  const filtered = options.bucket === "all" ? searched : searched.filter((row) => row.bucket === options.bucket);
  filtered.sort(compareRows(options.sort));
  const items = filtered.slice(options.offset, options.offset + options.limit);

  return { items, counts, page: buildPageInfo(options.limit, options.offset, filtered.length, items.length) };
}
