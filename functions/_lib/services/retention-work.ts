import type { PendingWorkListQuery, PendingWorkRow } from "../../../assets/shared/schemas/pending-work";
import type { RetentionRunResponse } from "../../../assets/shared/schemas/retention";
import { guardPermissionMutationDatabase } from "../auth/permissions";
import { queryPage } from "../db/pagination";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import { writeAuditLog } from "./audit";
import { DUE_RETENTION_PREDICATE, runRetentionJob, summarizeRetentionJob } from "./retention";

interface RetentionDueRow {
  event_id: string;
  event_name: string;
  event_slug: string;
  ends_at: string | null;
  retention_days: number;
  eligible_registrations: number;
}

/**
 * Events whose configured retention window has elapsed. This is the retention
 * domain's own pending list: one indexed query, so its count is exact rather
 * than a bounded preview window.
 */
export function buildRetentionDuePageQuery(query: PendingWorkListQuery) {
  const conditions = [DUE_RETENTION_PREDICATE];
  const bindings: unknown[] = [];
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["e.name", "e.slug"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  return {
    sql: `SELECT rp.event_id, e.name AS event_name, e.slug AS event_slug, e.ends_at,
                 rp.user_retention_days AS retention_days,
                 (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS eligible_registrations
            FROM retention_policies rp
            JOIN events e ON e.id = rp.event_id
           WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy: resolveMappedOrderBy(
      query.sort,
      { dueAt: "e.ends_at", title: "e.name COLLATE NOCASE", typeLabel: "e.slug COLLATE NOCASE" },
      "e.ends_at ASC",
      "rp.event_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

function toPendingWork(row: RetentionDueRow): PendingWorkRow {
  return {
    typeLabel: "Retention",
    title: row.event_name,
    subtitle: `${row.eligible_registrations} registration${row.eligible_registrations === 1 ? "" : "s"}`,
    context: row.event_slug,
    detail: `Retains identifying data for ${row.retention_days} day${row.retention_days === 1 ? "" : "s"} after the event ends`,
    dueAt: row.ends_at,
    statusKey: "due",
    statusLabel: "Due for redaction",
  };
}

export async function listRetentionDueWork(db: DatabaseLike, query: PendingWorkListQuery) {
  const page = await queryPage<RetentionDueRow>(db, buildRetentionDuePageQuery(query));
  return { items: page.rows.map(toPendingWork), total: page.total };
}

/**
 * Applies the configured retention policies. The caller's `retention:run` and
 * `users:anonymize` grants are re-evaluated inside the same D1 batch as the
 * redaction and its audit record, so revocation cannot race a prepared run.
 */
export async function createRetentionRun(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  mode: "preview" | "execute",
): Promise<RetentionRunResponse> {
  if (mode === "preview") {
    const preview = await summarizeRetentionJob(db);
    return {
      success: true,
      mode,
      redactedRegistrations: preview.totalRegistrations,
      redactedUsers: preview.totalUsers,
      affectedEvents: preview.totalEvents,
    };
  }
  const authorizedDb = guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "retention:run" }, { permission: "users:anonymize" }],
    () =>
      new AppError(
        409,
        "RETENTION_AUTHORIZATION_CHANGED",
        "Retention permission changed while the run was in progress",
      ),
  );
  await writeAuditLog(authorizedDb, "admin", actor.id, "retention_run_requested", "retention_job", null, {});
  const result = await runRetentionJob(authorizedDb);
  await writeAuditLog(authorizedDb, "admin", actor.id, "retention_run_completed", "retention_job", null, result);
  return { success: true, mode, ...result };
}
