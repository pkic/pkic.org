/**
 * Read model for GET /api/v1/admin/forms (P6M-P2-14) — lists every
 * admin-managed custom form across scopes with field/submission counts.
 * The dataset is inherently small (one row per configured form), but this
 * still composes a real `LIMIT`/`OFFSET` + `COUNT(*)` bound rather than
 * returning every row unbounded, matching every other admin list endpoint.
 */
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { AdminFormSummary, AdminFormsListQuery } from "../../../../assets/shared/schemas/admin-forms";

export type AdminFormSummaryRow = AdminFormSummary;

const FORMS_LIST_FROM = `
  FROM forms f
  LEFT JOIN events e ON e.id = f.scope_ref AND f.scope_type = 'event'
  LEFT JOIN form_fields ff ON ff.form_id = f.id
  LEFT JOIN form_submissions fs ON fs.form_id = f.id
`;

export async function listAdminForms(
  db: DatabaseLike,
  params: AdminFormsListQuery & {
    eventId?: string;
    includeGlobal?: boolean;
  },
): Promise<{ forms: AdminFormSummaryRow[]; total: number }> {
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (params.eventId) {
    conditions.push(
      params.includeGlobal
        ? "((f.scope_type = 'event' AND f.scope_ref = ?) OR f.scope_type = 'global')"
        : "f.scope_type = 'event' AND f.scope_ref = ?",
    );
    bindings.push(params.eventId);
  }
  if (params.purpose) {
    conditions.push("f.purpose = ?");
    bindings.push(params.purpose);
  }
  if (params.status) {
    conditions.push("f.status = ?");
    bindings.push(params.status);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "f.key",
      "f.title",
      "f.description",
      "f.purpose",
      "f.status",
      "e.name",
      "e.slug",
    ]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      key: "f.key COLLATE NOCASE",
      title: "f.title COLLATE NOCASE",
      purpose: "f.purpose",
      status: "f.status",
      scopeType: "f.scope_type",
      updatedAt: "f.updated_at",
      submissionCount: "submission_count",
    },
    "f.scope_type ASC, f.purpose ASC, f.updated_at DESC",
    "f.id ASC",
  );
  const { rows: forms, total } = await queryPage<AdminFormSummaryRow>(db, {
    sql: `SELECT
         f.id, f.key, f.scope_type, f.scope_ref, f.purpose, f.status,
         f.title, f.description, f.created_at, f.updated_at,
         e.slug AS event_slug,
         e.name AS event_name,
         COUNT(DISTINCT ff.id) AS field_count,
         COUNT(DISTINCT fs.id)
           + CASE WHEN f.scope_type = 'event' AND f.purpose = 'event_registration' THEN (
               SELECT COUNT(*) FROM registrations r
               WHERE r.event_id = f.scope_ref AND r.custom_answers_json IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM form_submissions fs2
                   WHERE fs2.form_id = f.id AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
                 )
             ) ELSE 0 END
           + CASE WHEN f.scope_type = 'event' AND f.purpose = 'proposal_submission' THEN (
               SELECT COUNT(*) FROM session_proposals sp
               WHERE sp.event_id = f.scope_ref AND sp.details_json IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM form_submissions fs2
                   WHERE fs2.form_id = f.id AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
                 )
             ) ELSE 0 END AS submission_count
       ${FORMS_LIST_FROM}
       ${where}
       GROUP BY f.id`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return { forms, total };
}
