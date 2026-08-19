/**
 * Read model for GET /api/v1/admin/forms (P6M-P2-14) — lists every
 * admin-managed custom form across scopes with field/submission counts.
 * The dataset is inherently small (one row per configured form), but this
 * still composes a real `LIMIT`/`OFFSET` + `COUNT(*)` bound rather than
 * returning every row unbounded, matching every other admin list endpoint.
 */
import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export interface AdminFormSummaryRow {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  event_slug: string | null;
  event_name: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  field_count: number;
  submission_count: number;
}

const FORMS_LIST_FROM = `
  FROM forms f
  LEFT JOIN events e ON e.id = f.scope_ref AND f.scope_type = 'event'
  LEFT JOIN form_fields ff ON ff.form_id = f.id
  LEFT JOIN form_submissions fs ON fs.form_id = f.id
`;

export async function listAdminForms(
  db: DatabaseLike,
  params: { limit: number; offset: number },
): Promise<{ forms: AdminFormSummaryRow[]; total: number }> {
  const [forms, totalRow] = await Promise.all([
    all<AdminFormSummaryRow>(
      db,
      `SELECT
         f.*,
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
       GROUP BY f.id
       ORDER BY f.scope_type ASC, f.purpose ASC, f.updated_at DESC
       LIMIT ? OFFSET ?`,
      [params.limit, params.offset],
    ),
    first<{ total: number }>(db, `SELECT COUNT(*) AS total FROM forms f`),
  ]);

  return { forms, total: totalRow?.total ?? 0 };
}
