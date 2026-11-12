import type { PendingWorkListQuery } from "../../../../assets/shared/schemas/pending-work";
import type { SchedulerJobBacklogItem } from "../../../../assets/shared/schemas/scheduler";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { first, run } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { processPromotionRenderJob } from "./promotion-render-jobs";

type BacklogKind = "kit" | "file" | "email";

interface PromotionBacklogRow {
  kind: BacklogKind;
  state: string;
  event_name: string;
  occurrence_id: string | null;
  formats: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  due_at: string | null;
  last_error: string | null;
  item_id: string;
}

/**
 * The promotion rendering job's unfinished work, oldest first: kits still being
 * prepared, files waiting to render, and emails waiting for those files. Each
 * part reads its own due or pending index; a run that died shows as interrupted.
 */
export function buildPromotionBacklogPageQuery(query: PendingWorkListQuery, now: string) {
  const source = `
    SELECT 'kit' AS kind,
           CASE WHEN r.status = 'preparing' AND r.lease_expires_at <= ? THEN 'interrupted' ELSE r.status END AS state,
           e.name AS event_name, r.occurrence_id, COALESCE(r.formats_json, b.formats_json) AS formats,
           u.first_name, u.last_name, u.email, r.next_attempt_at AS due_at, r.last_error,
           r.batch_id || ':' || COALESCE(r.occurrence_id, '') || ':' || r.user_id AS item_id
      FROM event_promotion_batch_recipients r
      JOIN event_promotion_batches b ON b.id = r.batch_id
      JOIN events e ON e.id = b.event_id
      JOIN users u ON u.id = r.user_id
     WHERE r.status IN ('queued', 'preparing')
    UNION ALL
    SELECT 'file',
           CASE WHEN p.status = 'rendering' AND p.lease_expires_at <= ? THEN 'interrupted' ELSE p.status END,
           e.name, p.occurrence_id, json_array(p.format),
           u.first_name, u.last_name, u.email, p.next_attempt_at, p.last_error, p.id
      FROM event_promotion_renders p
      JOIN events e ON e.id = p.event_id
      JOIN users u ON u.id = p.user_id
     WHERE p.status IN ('queued', 'retrying', 'rendering')
    UNION ALL
    SELECT 'email', 'waiting',
           e.name, r.occurrence_id, COALESCE(r.formats_json, b.formats_json),
           u.first_name, u.last_name, u.email, r.updated_at, NULL,
           r.batch_id || ':' || COALESCE(r.occurrence_id, '') || ':' || r.user_id
      FROM event_promotion_batch_recipients r
      JOIN event_promotion_batches b ON b.id = r.batch_id
      JOIN events e ON e.id = b.event_id
      JOIN users u ON u.id = r.user_id
     WHERE r.email_status = 'pending'`;
  const conditions: string[] = [];
  const bindings: unknown[] = [now, now];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, [
      "work.event_name",
      "work.first_name",
      "work.last_name",
      "work.email",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `SELECT work.kind, work.state, work.event_name, work.occurrence_id, work.formats,
                 work.first_name, work.last_name, work.email, work.due_at, work.last_error, work.item_id
            FROM (${source}) work${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        dueAt: "work.due_at",
        // The title the table shows: the full name, or the address when there is none.
        title: `COALESCE(NULLIF(TRIM(COALESCE(work.first_name, '') || ' ' || COALESCE(work.last_name, '')), ''), work.email) COLLATE NOCASE`,
        typeLabel: "work.kind",
      },
      "work.due_at ASC",
      // One recipient row is both a kit and an email, so the kind keeps the identifier unique.
      "work.kind ASC, work.item_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

const KIND_LABELS: Record<BacklogKind, string> = { kit: "Kit", file: "File", email: "Email" };

const STATE_LABELS: Record<string, { label: string; detail?: string }> = {
  "kit:queued": { label: "Waiting to prepare" },
  "kit:preparing": { label: "Preparing" },
  "file:queued": { label: "Waiting to render" },
  "file:retrying": { label: "Retrying" },
  "file:rendering": { label: "Rendering" },
  "email:waiting": { label: "Waiting for files", detail: "Goes to the outbox once every file is rendered." },
};

function formatList(json: string): string {
  try {
    const formats = JSON.parse(json) as unknown;
    if (!Array.isArray(formats)) return "";
    return formats
      .filter((format): format is string => typeof format === "string")
      .map((format) => format.charAt(0).toUpperCase() + format.slice(1))
      .join(", ");
  } catch {
    return "";
  }
}

/** Only a file render can run on its own; kits and emails follow from it. */
const RETRYABLE_FILE_STATES = new Set(["queued", "retrying", "interrupted"]);

function toPendingWork(row: PromotionBacklogRow): SchedulerJobBacklogItem {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  const state =
    row.state === "interrupted"
      ? { label: "Interrupted", detail: "The run stopped before it finished. The next run starts it again." }
      : (STATE_LABELS[`${row.kind}:${row.state}`] ?? { label: row.state });
  const kit = row.occurrence_id ? "Session kit" : "Attendee kit";
  const formats = formatList(row.formats);
  return {
    id: `${row.kind}:${row.item_id}`,
    retryable: row.kind === "file" && RETRYABLE_FILE_STATES.has(row.state),
    typeLabel: KIND_LABELS[row.kind],
    title: name || row.email,
    subtitle: row.event_name,
    context: formats ? `${kit} · ${formats}` : kit,
    detail: row.last_error ?? state.detail ?? null,
    dueAt: row.due_at,
    statusKey: row.state,
    statusLabel: state.label,
  };
}

export async function listPromotionRenderingBacklog(db: DatabaseLike, query: PendingWorkListQuery) {
  const page = await queryPage<PromotionBacklogRow>(db, buildPromotionBacklogPageQuery(query, nowIso()));
  return { items: page.rows.map(toPendingWork), total: page.total };
}

/**
 * Renders one waiting file now. It goes through the job's own claim, so a run
 * that picks the same file at the same moment does not render it twice.
 */
export async function retryPromotionBacklogItem(db: DatabaseLike, env: Env, itemId: string) {
  const id = itemId.startsWith("file:") ? itemId.slice("file:".length) : null;
  const notRetryable = () => new AppError(404, "BACKLOG_ITEM_NOT_FOUND", "This work is finished or cannot be retried.");
  if (!id) throw notRetryable();
  const now = nowIso();
  // A waiting retry becomes due now; an interrupted render is claimable once its lease expired.
  await run(
    db,
    "UPDATE event_promotion_renders SET next_attempt_at=?, updated_at=? WHERE id=? AND status IN ('queued','retrying')",
    [now, now, id],
  );
  const before = await first<{ status: string; lease_expires_at: string | null }>(
    db,
    "SELECT status, lease_expires_at FROM event_promotion_renders WHERE id=?",
    [id],
  );
  if (!before || !["queued", "retrying", "rendering"].includes(before.status)) throw notRetryable();
  if (before.status === "rendering" && before.lease_expires_at !== null && before.lease_expires_at > now) {
    throw new AppError(409, "BACKLOG_ITEM_IN_PROGRESS", "This file is rendering right now.");
  }
  const finished = await processPromotionRenderJob(db, env, id);
  const after = await first<{ last_error: string | null }>(
    db,
    "SELECT last_error FROM event_promotion_renders WHERE id=?",
    [id],
  );
  return { finished, error: finished ? null : (after?.last_error ?? null) };
}
