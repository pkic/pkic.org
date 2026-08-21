import { getConfig } from "../config";
import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import type { AdminDueWorkRow, AdminDueWorkTab } from "../../../assets/shared/schemas/admin-due-work";
import type { DatabaseLike, Env } from "../types";

const ONE_DAY_MS = 86_400_000;

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

interface DueWorkQueryRow {
  record_kind: number;
  page_position: number;
  bucket: AdminDueWorkRow["bucket"] | null;
  type_label: string | null;
  title: string | null;
  subtitle: string | null;
  context: string | null;
  detail: string | null;
  due_at: string | null;
  status_key: string | null;
  status_label: string | null;
  page_total: number;
  all_count: number;
  outbox_count: number;
  reminders_count: number;
  cleanup_count: number;
}

/**
 * Canonical D1 projection for the dashboard. Candidate discovery, global
 * reminder/outbox caps, search, bucket counts, sorting, and pagination all
 * happen in SQLite; the Worker only maps the bounded result into the API
 * naming convention.
 */
const DUE_WORK_CTE = `
  WITH cfg AS (
    SELECT ? AS now_at,
           ? AS reminder_cutoff,
           ? AS confirmation_cutoff,
           ? AS presentation_window_end,
           ? AS max_invite_reminders,
           ? AS max_confirmation_reminders,
           ? AS confirmation_interval_days,
           ? AS confirmation_fallback_days,
           ? AS max_presentation_reminders,
           ? AS reminder_limit,
           ? AS outbox_limit,
           ? AS include_retention
  ),
  outbox_source AS (
    SELECT id,
           event_id,
           recipient_email,
           template_key,
           attempts,
           subject,
           send_after,
           status,
           CASE WHEN json_valid(payload_json) THEN payload_json ELSE '{}' END AS safe_payload_json
    FROM email_outbox
  ),
  outbox_candidates AS (
    SELECT 'outbox' AS bucket,
           'Email Queue' AS type_label,
           COALESCE(
             NULLIF(TRIM(COALESCE(json_extract(o.safe_payload_json, '$.firstName'), '') || ' ' ||
                          COALESCE(json_extract(o.safe_payload_json, '$.lastName'), '')), ''),
             o.recipient_email
           ) AS title,
           CASE
             WHEN NULLIF(TRIM(COALESCE(json_extract(o.safe_payload_json, '$.firstName'), '') || ' ' ||
                                  COALESCE(json_extract(o.safe_payload_json, '$.lastName'), '')), '') IS NULL
               THEN NULL
             ELSE o.recipient_email
           END AS subtitle,
           TRIM(COALESCE(e.name || ' | ', '') || o.template_key || ' | Attempts ' || o.attempts) AS context,
           o.subject AS detail,
           o.send_after AS due_at,
           o.status AS status_key,
           o.status AS status_label,
           o.id AS source_id,
           ROW_NUMBER() OVER (ORDER BY o.send_after ASC, o.id ASC) AS candidate_rank
    FROM outbox_source o
    LEFT JOIN events e ON e.id = o.event_id
    CROSS JOIN cfg
    WHERE o.status IN ('queued', 'retrying') AND o.send_after <= cfg.now_at
  ),
  invite_candidates AS (
    SELECT i.*,
           e.name AS event_name,
           e.slug AS event_slug,
           e.starts_at AS event_starts_at,
           CASE WHEN json_valid(e.settings_json)
             THEN COALESCE(
               json_extract(e.settings_json, '$.registration.closesAt'),
               json_extract(e.settings_json, '$.registrationClosesAt')
             )
             ELSE NULL
           END AS registration_closes_at,
           COALESCE(i.last_communication_at, i.created_at) AS candidate_due_at
    FROM invites i
    JOIN events e ON e.id = i.event_id
    CROSS JOIN cfg
    WHERE i.status = 'sent'
      AND i.reminder_count < cfg.max_invite_reminders
      AND (i.reminders_paused_until IS NULL OR i.reminders_paused_until <= cfg.now_at)
      AND COALESCE(i.last_communication_at, i.created_at) <= cfg.reminder_cutoff
  ),
  reminder_candidates AS (
    SELECT 1 AS category_priority,
           i.candidate_due_at AS source_due_at,
           i.id AS source_id,
           'reminders' AS bucket,
           CASE WHEN i.invite_type = 'attendee' THEN 'Attendee Invite' ELSE 'Speaker Invite' END AS type_label,
           COALESCE(NULLIF(TRIM(COALESCE(i.invitee_first_name, '') || ' ' || COALESCE(i.invitee_last_name, '')), ''), i.invitee_email) AS title,
           CASE WHEN NULLIF(TRIM(COALESCE(i.invitee_first_name, '') || ' ' || COALESCE(i.invitee_last_name, '')), '') IS NULL
             THEN NULL ELSE i.invitee_email END AS subtitle,
           i.event_name || ' | ' || i.event_slug || ' | ' ||
             CASE WHEN i.invite_type = 'attendee' THEN 'attendee_invite' ELSE 'speaker_invite' END ||
             ' | #' || (i.reminder_count + 1) AS context,
           'Reminder: invitation response requested for ' || i.event_name AS detail,
           CASE
             WHEN i.invite_type = 'attendee' AND i.expires_at IS NOT NULL AND i.registration_closes_at IS NOT NULL
               THEN MIN(i.expires_at, i.registration_closes_at)
             WHEN i.invite_type = 'attendee' THEN COALESCE(i.expires_at, i.registration_closes_at)
             ELSE i.expires_at
           END AS due_at,
           'pending' AS status_key,
           'Preview' AS status_label
    FROM invite_candidates i
    CROSS JOIN cfg
    WHERE i.invite_type <> 'attendee'
       OR ((i.event_starts_at IS NULL OR i.event_starts_at > cfg.now_at)
           AND (i.registration_closes_at IS NULL OR i.registration_closes_at > cfg.now_at))

    UNION ALL

    SELECT 2,
           COALESCE(ps.speaker_invite_last_communication_at, ps.created_at),
           ps.id,
           'reminders',
           'Co-speaker Invite',
           COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email),
           CASE WHEN NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') IS NULL
             THEN NULL ELSE u.email END,
           e.name || ' | ' || e.slug || ' | co_speaker_invite | #' || (ps.speaker_invite_reminder_count + 1),
           'Reminder: please confirm speaker participation — ' || e.name || ' | ' || sp.title,
           e.starts_at,
           'pending',
           'Preview'
    FROM proposal_speakers ps
    JOIN users u ON u.id = ps.user_id
    JOIN session_proposals sp ON sp.id = ps.proposal_id
    JOIN events e ON e.id = sp.event_id
    CROSS JOIN cfg
    WHERE ps.status = 'invited'
      AND ps.role <> 'proposer'
      AND sp.status NOT IN ('rejected', 'withdrawn')
      AND (e.starts_at IS NULL OR e.starts_at > cfg.now_at)
      AND ps.speaker_invite_reminder_count < cfg.max_invite_reminders
      AND (ps.speaker_invite_reminders_paused_until IS NULL OR ps.speaker_invite_reminders_paused_until <= cfg.now_at)
      AND COALESCE(ps.speaker_invite_last_communication_at, ps.created_at) <= cfg.reminder_cutoff

    UNION ALL

    SELECT 3,
           COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at),
           ps.id,
           'reminders',
           'Presentation Upload',
           COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), u.email),
           CASE WHEN NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') IS NULL
             THEN NULL ELSE u.email END,
           e.name || ' | ' || e.slug || ' | presentation_upload_request | #' || (ps.presentation_reminder_count + 1),
           'Reminder: please upload your presentation — ' || e.name || ' | ' || sp.title,
           COALESCE(sp.presentation_deadline, e.starts_at),
           'pending',
           'Preview'
    FROM proposal_speakers ps
    JOIN users u ON u.id = ps.user_id
    JOIN session_proposals sp ON sp.id = ps.proposal_id
    JOIN events e ON e.id = sp.event_id
    CROSS JOIN cfg
    WHERE sp.status = 'accepted'
      AND ps.status IN ('invited', 'confirmed')
      AND NOT EXISTS (
        SELECT 1 FROM presentation_versions pv
        WHERE pv.proposal_id = sp.id AND pv.is_current = 1 AND pv.deleted_at IS NULL
      )
      AND COALESCE(sp.presentation_deadline, e.starts_at) > cfg.now_at
      AND COALESCE(sp.presentation_deadline, e.starts_at) <= cfg.presentation_window_end
      AND ps.presentation_reminder_count < cfg.max_presentation_reminders
      AND (ps.presentation_reminders_paused_until IS NULL OR ps.presentation_reminders_paused_until <= cfg.now_at)
      AND COALESCE(ps.presentation_last_communication_at, sp.updated_at, ps.created_at) <= cfg.reminder_cutoff

    UNION ALL

    SELECT 4,
           COALESCE(r.confirmation_reminder_sent_at, r.created_at),
           r.id,
           'reminders',
           'Registration Confirmation',
           COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), COALESCE(u.pending_email, u.email)),
           CASE WHEN NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), '') IS NULL
             THEN NULL ELSE COALESCE(u.pending_email, u.email) END,
           e.name || ' | ' || e.slug || ' | registration_confirmation_reminder | #' ||
             (MAX(0, MIN(cfg.max_confirmation_reminders - 1,
               CAST(((julianday(cfg.now_at) - julianday(r.created_at)) / cfg.confirmation_interval_days) AS INTEGER) - 1)) + 1),
           'Reminder: please confirm your registration for ' || e.name,
           COALESCE(r.pending_confirmation_deadline_at, datetime(r.created_at, '+' || cfg.confirmation_fallback_days || ' days')),
           'pending',
           'Preview'
    FROM registrations r
    JOIN events e ON e.id = r.event_id
    JOIN users u ON u.id = r.user_id
    CROSS JOIN cfg
    WHERE r.status = 'pending_email_confirmation'
      AND r.confirmation_link_secret IS NOT NULL
      AND datetime(COALESCE(r.confirmation_reminder_sent_at, r.created_at)) <= datetime(cfg.confirmation_cutoff)
      AND julianday(COALESCE(r.pending_confirmation_deadline_at,
                            datetime(r.created_at, '+' || cfg.confirmation_fallback_days || ' days'))) > julianday(cfg.now_at)
  ),
  ranked_reminders AS (
    SELECT *, ROW_NUMBER() OVER (ORDER BY category_priority, source_due_at, source_id) AS candidate_rank
    FROM reminder_candidates
  ),
  cleanup_candidates AS (
    SELECT 'cleanup' AS bucket,
           'Cleanup' AS type_label,
           e.name AS title,
           e.slug AS subtitle,
           COUNT(r.id) || ' regs | ' || COUNT(DISTINCT r.user_id) || ' users | ' ||
             rp.user_retention_days || 'd retention' AS context,
           'Event ended ' || e.ends_at AS detail,
           e.ends_at AS due_at,
           'waiting' AS status_key,
           'Eligible' AS status_label,
           e.id AS source_id
    FROM retention_policies rp
    JOIN events e ON e.id = rp.event_id
    LEFT JOIN registrations r ON r.event_id = e.id
    CROSS JOIN cfg
    WHERE cfg.include_retention = 1
      AND e.ends_at IS NOT NULL
      AND datetime(e.ends_at) < datetime(cfg.now_at, '-' || rp.user_retention_days || ' days')
    GROUP BY e.id, e.name, e.slug, e.ends_at, rp.user_retention_days
  ),
  work_items AS (
    SELECT bucket, type_label, title, subtitle, context, detail, due_at, status_key, status_label, source_id
    FROM outbox_candidates, cfg WHERE candidate_rank <= cfg.outbox_limit
    UNION ALL
    SELECT bucket, type_label, title, subtitle, context, detail, due_at, status_key, status_label, source_id
    FROM ranked_reminders, cfg WHERE candidate_rank <= cfg.reminder_limit
    UNION ALL
    SELECT bucket, type_label, title, subtitle, context, detail, due_at, status_key, status_label, source_id
    FROM cleanup_candidates
  )`;

function queryBindings(env: Env, appBaseUrl: string, options: DueWorkListOptions): unknown[] {
  const config = getConfig({ ...env, APP_BASE_URL: appBaseUrl });
  const now = new Date();
  const confirmationIntervalDays = Math.max(1, config.pendingConfirmationReminderIntervalDays);
  return [
    now.toISOString(),
    new Date(now.getTime() - config.reminderIntervalDays * ONE_DAY_MS).toISOString(),
    new Date(now.getTime() - confirmationIntervalDays * ONE_DAY_MS).toISOString(),
    new Date(now.getTime() + config.presentationReminderLeadDays * ONE_DAY_MS).toISOString(),
    config.maxInviteReminders,
    config.maxPendingConfirmationReminders,
    confirmationIntervalDays,
    (config.maxPendingConfirmationReminders + 1) * confirmationIntervalDays,
    config.maxPresentationReminders,
    options.reminderLimit,
    options.outboxLimit,
    options.includeRetention ? 1 : 0,
  ];
}

function orderTerms(sort: string | undefined): string {
  const descending = sort?.startsWith("-") ?? false;
  const key = descending ? sort!.slice(1) : (sort ?? "dueAt");
  const column =
    key === "title"
      ? "title COLLATE NOCASE"
      : key === "typeLabel"
        ? "type_label COLLATE NOCASE"
        : "COALESCE(due_at, '9999')";
  const direction = descending ? "DESC" : "ASC";
  return `${column} ${direction}, title COLLATE NOCASE ${direction}, context COLLATE NOCASE ${direction}, source_id ${direction}`;
}

function toApiRow(row: DueWorkQueryRow): AdminDueWorkRow {
  return {
    bucket: row.bucket!,
    typeLabel: row.type_label!,
    title: row.title!,
    subtitle: row.subtitle,
    context: row.context!,
    detail: row.detail,
    dueAt: row.due_at,
    statusKey: row.status_key!,
    statusLabel: row.status_label!,
  };
}

export async function listDueWork(db: DatabaseLike, env: Env, appBaseUrl: string, options: DueWorkListOptions) {
  const search = options.q
    ? buildD1TextSearchFilter(options.q, ["type_label", "title", "subtitle", "context", "detail"])
    : null;
  const searchWhere = search ? `WHERE ${search.sql}` : "";
  const orderBy = orderTerms(options.sort);
  const sql = `${DUE_WORK_CTE},
    searched AS (
      SELECT * FROM work_items ${searchWhere}
    ),
    counts AS (
      SELECT COUNT(*) AS all_count,
             COALESCE(SUM(bucket = 'outbox'), 0) AS outbox_count,
             COALESCE(SUM(bucket = 'reminders'), 0) AS reminders_count,
             COALESCE(SUM(bucket = 'cleanup'), 0) AS cleanup_count
      FROM searched
    ),
    filtered AS (
      SELECT * FROM searched WHERE ? = 'all' OR bucket = ?
    ),
    page_totals AS (
      SELECT COUNT(*) AS page_total FROM filtered
    ),
    paged AS (
      SELECT *, ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS page_position
      FROM filtered
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    )
    SELECT 0 AS record_kind, -1 AS page_position,
           NULL AS bucket, NULL AS type_label, NULL AS title, NULL AS subtitle,
           NULL AS context, NULL AS detail, NULL AS due_at, NULL AS status_key,
           NULL AS status_label, page_totals.page_total,
           counts.all_count, counts.outbox_count, counts.reminders_count, counts.cleanup_count
    FROM counts CROSS JOIN page_totals
    UNION ALL
    SELECT 1, paged.page_position,
           paged.bucket, paged.type_label, paged.title, paged.subtitle,
           paged.context, paged.detail, paged.due_at, paged.status_key,
           paged.status_label, page_totals.page_total,
           counts.all_count, counts.outbox_count, counts.reminders_count, counts.cleanup_count
    FROM paged CROSS JOIN counts CROSS JOIN page_totals
    ORDER BY record_kind, page_position`;

  const bindings = [
    ...queryBindings(env, appBaseUrl, options),
    ...(search?.bindings ?? []),
    options.bucket,
    options.bucket,
    options.limit,
    options.offset,
  ];
  const result = await db
    .prepare(sql)
    .bind(...bindings)
    .all();
  const rows = (result.results ?? []) as unknown as DueWorkQueryRow[];
  const metadata = rows[0]!;
  const items = rows.slice(1).map(toApiRow);
  const total = Number(metadata.page_total);
  return {
    items,
    counts: {
      all: Number(metadata.all_count),
      outbox: Number(metadata.outbox_count),
      reminders: Number(metadata.reminders_count),
      cleanup: Number(metadata.cleanup_count),
    },
    page: buildPageInfo(options.limit, options.offset, total, items.length),
  };
}
