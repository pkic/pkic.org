import type { PendingWorkListQuery, PendingWorkRow } from "../../../../assets/shared/schemas/pending-work";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";

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
           u.first_name, u.last_name, u.email, r.next_attempt_at AS due_at, r.last_error
      FROM event_promotion_batch_recipients r
      JOIN event_promotion_batches b ON b.id = r.batch_id
      JOIN events e ON e.id = b.event_id
      JOIN users u ON u.id = r.user_id
     WHERE r.status IN ('queued', 'preparing')
    UNION ALL
    SELECT 'file',
           CASE WHEN p.status = 'rendering' AND p.lease_expires_at <= ? THEN 'interrupted' ELSE p.status END,
           e.name, p.occurrence_id, json_array(p.format),
           u.first_name, u.last_name, u.email, p.next_attempt_at, p.last_error
      FROM event_promotion_renders p
      JOIN events e ON e.id = p.event_id
      JOIN users u ON u.id = p.user_id
     WHERE p.status IN ('queued', 'retrying', 'rendering')
    UNION ALL
    SELECT 'email', 'waiting',
           e.name, r.occurrence_id, COALESCE(r.formats_json, b.formats_json),
           u.first_name, u.last_name, u.email, r.updated_at, NULL
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
    sql: `SELECT work.* FROM (${source}) work${conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      {
        dueAt: "work.due_at",
        title: "COALESCE(work.first_name, work.email) COLLATE NOCASE",
        typeLabel: "work.kind",
      },
      "work.due_at ASC",
      "work.email ASC",
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

function toPendingWork(row: PromotionBacklogRow): PendingWorkRow {
  const name = [row.first_name, row.last_name].filter(Boolean).join(" ");
  const state =
    row.state === "interrupted"
      ? { label: "Interrupted", detail: "The run stopped before it finished. The next run starts it again." }
      : (STATE_LABELS[`${row.kind}:${row.state}`] ?? { label: row.state });
  const kit = row.occurrence_id ? "Session kit" : "Attendee kit";
  const formats = formatList(row.formats);
  return {
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
