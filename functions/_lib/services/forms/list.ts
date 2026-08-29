/** Bounded form-definition catalogue shared by global and event routes. */
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import type { FormSummary, FormsListQuery } from "../../../../assets/shared/schemas/form-management";

export type FormSummaryRow = FormSummary;

export type FormResponseContext = { type: "installation"; ref: null } | { type: "event"; ref: string };

const FORMS_LIST_FROM = `
  FROM forms f
  LEFT JOIN events e ON e.id = f.scope_ref AND f.scope_type = 'event'
`;

/** Build the bounded catalogue page/count pair without joining every field to every submission. */
export function buildFormsPageQuery(
  params: FormsListQuery & {
    eventId?: string;
    includeGlobal?: boolean;
    globalOnly?: boolean;
    responseContext?: FormResponseContext;
    excludedFormKeys?: readonly string[];
  },
): OffsetPageQuery {
  const responseContext =
    params.responseContext ??
    (params.globalOnly
      ? ({ type: "installation", ref: null } as const)
      : params.eventId
        ? ({ type: "event", ref: params.eventId } as const)
        : null);
  const conditions: string[] = [];
  const bindings: unknown[] = responseContext ? [responseContext.type, responseContext.ref] : [];
  if (params.eventId) {
    conditions.push(
      params.includeGlobal
        ? `((f.scope_type = 'event' AND f.scope_ref = (SELECT context_ref FROM response_context))
            OR f.scope_type = 'global'
            OR EXISTS (
              SELECT 1 FROM form_placements fp
              WHERE fp.form_id = f.id
                AND fp.owner_group_id IS NULL
                AND ((fp.context_type = 'event'
                      AND fp.context_ref = (SELECT context_ref FROM response_context))
                     OR fp.context_type = 'installation')
            ))`
        : `((f.scope_type = 'event' AND f.scope_ref = (SELECT context_ref FROM response_context))
            OR EXISTS (
              SELECT 1 FROM form_placements fp
              WHERE fp.form_id = f.id AND fp.owner_group_id IS NULL AND fp.context_type = 'event'
                AND fp.context_ref = (SELECT context_ref FROM response_context)
            ))`,
    );
  }
  if (params.globalOnly) {
    conditions.push("f.scope_type = 'global'");
  }
  if (params.purpose) {
    conditions.push("f.purpose = ?");
    bindings.push(params.purpose);
  }
  if (params.status) {
    conditions.push("f.status = ?");
    bindings.push(params.status);
  }
  if (params.excludedFormKeys?.length) {
    conditions.push(`f.key NOT IN (${params.excludedFormKeys.map(() => "?").join(", ")})`);
    bindings.push(...params.excludedFormKeys);
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
  const placementCount = responseContext
    ? `(SELECT COUNT(*) FROM form_placements fp
         WHERE fp.form_id = f.id
           AND fp.owner_group_id IS NULL
           AND fp.context_type = (SELECT context_type FROM response_context)
           AND fp.context_ref IS (SELECT context_ref FROM response_context))`
    : "(SELECT COUNT(*) FROM form_placements fp WHERE fp.form_id = f.id)";
  const nativeSubmissionCount =
    responseContext?.type === "installation"
      ? `(SELECT COUNT(*) FROM form_submissions fs
           WHERE fs.form_id = f.id
             AND (
               fs.placement_id IN (
                 SELECT fp.id FROM form_placements fp
                  WHERE fp.form_id = f.id AND fp.owner_group_id IS NULL
                    AND fp.context_type = 'installation' AND fp.context_ref IS NULL
               )
               OR (fs.placement_id IS NULL AND f.scope_type = 'global')
             ))`
      : responseContext?.type === "event"
        ? `(SELECT COUNT(*) FROM form_submissions fs
             WHERE fs.form_id = f.id
               AND (
                 fs.placement_id IN (
                   SELECT fp.id FROM form_placements fp
                   WHERE fp.form_id = f.id AND fp.context_type = 'event'
                     AND fp.owner_group_id IS NULL
                      AND fp.context_ref = (SELECT context_ref FROM response_context)
                 )
                 OR (fs.placement_id IS NULL AND f.scope_type = 'event'
                     AND f.scope_ref = (SELECT context_ref FROM response_context))
               ))`
        : "(SELECT COUNT(*) FROM form_submissions fs WHERE fs.form_id = f.id)";
  const legacyRegistrationCount =
    responseContext?.type === "event"
      ? `+ CASE WHEN f.purpose = 'event_registration' AND (
             (f.scope_type = 'event' AND f.scope_ref = (SELECT context_ref FROM response_context))
             OR EXISTS (
               SELECT 1 FROM form_placements fp
               WHERE fp.form_id = f.id AND fp.context_type = 'event'
                 AND fp.owner_group_id IS NULL
                  AND fp.context_ref = (SELECT context_ref FROM response_context)
             )
           ) THEN (
             SELECT COUNT(*) FROM registrations r
              WHERE r.event_id = (SELECT context_ref FROM response_context)
                AND r.custom_answers_json IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM form_submissions fs2
                   WHERE fs2.form_id = f.id AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
                )
           ) ELSE 0 END`
      : "";
  const legacyProposalCount =
    responseContext?.type === "event"
      ? `+ CASE WHEN f.purpose = 'proposal_submission' AND (
             (f.scope_type = 'event' AND f.scope_ref = (SELECT context_ref FROM response_context))
             OR EXISTS (
               SELECT 1 FROM form_placements fp
               WHERE fp.form_id = f.id AND fp.context_type = 'event'
                 AND fp.owner_group_id IS NULL
                  AND fp.context_ref = (SELECT context_ref FROM response_context)
             )
           ) THEN (
             SELECT COUNT(*) FROM session_proposals sp
              WHERE sp.event_id = (SELECT context_ref FROM response_context)
                AND sp.details_json IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM form_submissions fs2
                   WHERE fs2.form_id = f.id AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
                )
           ) ELSE 0 END`
      : "";
  return {
    source: {
      ...(responseContext
        ? {
            withSql: "WITH response_context(context_type, context_ref) AS (SELECT CAST(? AS TEXT), CAST(? AS TEXT))",
          }
        : {}),
      selectSql: `SELECT
         f.id, f.key, f.scope_type, f.scope_ref, f.purpose, f.status,
         f.title, f.description, f.created_at, f.updated_at,
         e.slug AS event_slug,
         e.name AS event_name,
         (SELECT COUNT(*) FROM form_fields ff WHERE ff.form_id = f.id) AS field_count,
         ${placementCount} AS placement_count,
         ${nativeSubmissionCount}
           ${legacyRegistrationCount}
           ${legacyProposalCount} AS submission_count
       `,
      fromSql: `${FORMS_LIST_FROM} ${where}`,
      bindings,
    },
    orderBy,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function listForms(
  db: DatabaseLike,
  params: FormsListQuery & {
    eventId?: string;
    includeGlobal?: boolean;
    globalOnly?: boolean;
    responseContext?: FormResponseContext;
    excludedFormKeys?: readonly string[];
  },
): Promise<{ forms: FormSummaryRow[]; total: number }> {
  const { rows: forms, total } = await queryPage<FormSummaryRow>(db, buildFormsPageQuery(params));

  return { forms, total };
}
