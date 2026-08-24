/**
 * Canonical SQL population shared by the submissions page, its count, and
 * per-field statistics. A form can contribute its native form_submissions
 * rows plus one legacy source for its purpose (registrations or proposals).
 * Keeping every filter here prevents list/count/statistics drift.
 */
import { buildD1TextSearchFilter } from "../../db/search";
import { AppError } from "../../errors";
import { getEventBySlug } from "../events";
import { getFormByKey } from "./form-definition";
import { findFormPlacement } from "../forms";
import type { DatabaseLike } from "../../types";
import type { FormRow, FormSubmissionFilters } from "./types";
import type { FormPlacement } from "../../../../assets/shared/schemas/forms";

interface SqlFragment {
  sql: string;
  bindings: unknown[];
}

export interface MergedSubmissionRow {
  id: string;
  source: "submission" | "registration" | "proposal";
  source_id: string;
  context_type: string | null;
  context_ref: string | null;
  status: string;
  submitted_at: string;
  user_id: string | null;
  user_email: string | null;
  user_first_name: string | null;
  user_last_name: string | null;
  user_organization: string | null;
  answers_json: string | null;
}

export interface FormSubmissionPopulation {
  form: FormRow;
  placement: FormPlacement | null;
  cte: string;
  bindings: unknown[];
}

export interface PopulationQuery {
  sql: string;
  bindings: unknown[];
}

export const MERGED_SUBMISSION_COLUMNS = `id, source, source_id, context_type, context_ref, status, submitted_at,
  user_id, user_email, user_first_name, user_last_name, user_organization, answers_json`;

function optionalEquality(expression: string, value: string | undefined): SqlFragment {
  return value ? { sql: `AND ${expression} = ?`, bindings: [value] } : { sql: "", bindings: [] };
}

function optionalSearch(query: string | undefined, expressions: readonly string[]): SqlFragment {
  if (!query) return { sql: "", bindings: [] };
  const search = buildD1TextSearchFilter(query, expressions);
  return { sql: `AND ${search.sql}`, bindings: search.bindings };
}

function submitterSortSql(firstName: string, lastName: string, email: string): string {
  return `LOWER(COALESCE(NULLIF(TRIM(COALESCE(${firstName},'') || ' ' || COALESCE(${lastName},'')), ''), ${email}, ''))`;
}

function domainPlacementFilter(
  column: string,
  placementId: string | null,
  includeLegacyUnplaced: boolean,
): SqlFragment {
  if (!placementId) return { sql: `${column} IS NULL`, bindings: [] };
  return {
    sql: includeLegacyUnplaced ? `(${column} = ? OR ${column} IS NULL)` : `${column} = ?`,
    bindings: [placementId],
  };
}

function nativeSubmissionBranch(params: {
  formId: string;
  placementId: string | null;
  includeLegacyUnplaced: boolean;
  purpose: string;
  eventId: string | null;
  status?: string;
  attendanceType?: string;
  q?: string;
}): SqlFragment {
  const isRegistration = params.purpose === "event_registration";
  const isProposal = params.purpose === "proposal_submission";
  const canonicalStatus = isRegistration
    ? "COALESCE(source_registration.status, fs.status)"
    : isProposal
      ? "COALESCE(source_proposal.status, fs.status)"
      : "fs.status";
  const canonicalUserId = isRegistration
    ? "COALESCE(fs.submitted_by_user_id, source_registration.user_id)"
    : isProposal
      ? "COALESCE(fs.submitted_by_user_id, source_proposal.proposer_user_id)"
      : "fs.submitted_by_user_id";
  const contextJoin = isRegistration
    ? "LEFT JOIN registrations source_registration ON source_registration.id = fs.context_ref AND fs.context_type = 'registration'"
    : isProposal
      ? "LEFT JOIN session_proposals source_proposal ON source_proposal.id = fs.context_ref AND fs.context_type = 'proposal'"
      : "";
  const status = optionalEquality(canonicalStatus, params.status);
  const attendance = isRegistration
    ? optionalEquality("source_registration.attendance_type", params.attendanceType)
    : { sql: "", bindings: [] };
  const eventScope =
    params.eventId && isRegistration
      ? optionalEquality("source_registration.event_id", params.eventId)
      : params.eventId && isProposal
        ? optionalEquality("source_proposal.event_id", params.eventId)
        : { sql: "", bindings: [] };
  const searchExpressions = [
    "u.email",
    "u.first_name",
    "u.last_name",
    "u.organization_name",
    canonicalStatus,
    ...(isProposal ? ["source_proposal.title"] : []),
  ];
  const search = optionalSearch(params.q, searchExpressions);
  const submitter = submitterSortSql("u.first_name", "u.last_name", "u.email");
  const responseSet = params.placementId
    ? {
        sql: params.includeLegacyUnplaced
          ? "fs.form_id = ? AND (fs.placement_id = ? OR fs.placement_id IS NULL)"
          : "fs.form_id = ? AND fs.placement_id = ?",
        bindings: [params.formId, params.placementId],
      }
    : { sql: "fs.form_id = ? AND fs.placement_id IS NULL", bindings: [params.formId] };
  const submissionSource = params.placementId
    ? "form_submissions fs INDEXED BY idx_form_submissions_placement_status"
    : "form_submissions fs";

  return {
    sql: `SELECT
       fs.id AS id,
       'submission' AS source,
       fs.id AS source_id,
       fs.context_type AS context_type,
       fs.context_ref AS context_ref,
       ${canonicalStatus} AS status,
       fs.submitted_at AS submitted_at,
       ${canonicalUserId} AS user_id,
       u.email AS user_email,
       u.first_name AS user_first_name,
       u.last_name AS user_last_name,
       u.organization_name AS user_organization,
       NULL AS answers_json,
       ${submitter} AS submitter
     FROM ${submissionSource}
     ${contextJoin}
     LEFT JOIN users u ON u.id = ${canonicalUserId}
     WHERE ${responseSet.sql}
     ${status.sql}
     ${attendance.sql}
     ${eventScope.sql}
     ${search.sql}`,
    bindings: [
      ...responseSet.bindings,
      ...status.bindings,
      ...attendance.bindings,
      ...eventScope.bindings,
      ...search.bindings,
    ],
  };
}

function legacyRegistrationBranch(params: {
  eventId: string;
  formId: string;
  placementId: string | null;
  includeLegacyUnplaced: boolean;
  status?: string;
  attendanceType?: string;
  q?: string;
}): SqlFragment {
  const status = optionalEquality("r.status", params.status);
  const attendance = optionalEquality("r.attendance_type", params.attendanceType);
  const search = optionalSearch(params.q, [
    "u.email",
    "u.first_name",
    "u.last_name",
    "u.organization_name",
    "r.status",
  ]);
  const submitter = submitterSortSql("u.first_name", "u.last_name", "u.email");
  const responseSet = domainPlacementFilter("r.form_placement_id", params.placementId, params.includeLegacyUnplaced);

  return {
    sql: `SELECT
       'registration:' || r.id AS id,
       'registration' AS source,
       r.id AS source_id,
       'registration' AS context_type,
       r.id AS context_ref,
       r.status AS status,
       r.created_at AS submitted_at,
       r.user_id AS user_id,
       u.email AS user_email,
       u.first_name AS user_first_name,
       u.last_name AS user_last_name,
       u.organization_name AS user_organization,
       r.custom_answers_json AS answers_json,
       ${submitter} AS submitter
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.event_id = ?
       AND ${responseSet.sql}
       AND r.custom_answers_json IS NOT NULL
       ${status.sql}
       ${attendance.sql}
       ${search.sql}
       AND NOT EXISTS (
         SELECT 1 FROM form_submissions fs2
         WHERE fs2.form_id = ? AND fs2.context_type = 'registration' AND fs2.context_ref = r.id
       )`,
    bindings: [
      params.eventId,
      ...responseSet.bindings,
      ...status.bindings,
      ...attendance.bindings,
      ...search.bindings,
      params.formId,
    ],
  };
}

function legacyProposalBranch(params: {
  eventId: string;
  formId: string;
  placementId: string | null;
  includeLegacyUnplaced: boolean;
  status?: string;
  q?: string;
}): SqlFragment {
  const status = optionalEquality("sp.status", params.status);
  const search = optionalSearch(params.q, [
    "u.email",
    "u.first_name",
    "u.last_name",
    "u.organization_name",
    "sp.status",
    "sp.title",
  ]);
  const submitter = submitterSortSql("u.first_name", "u.last_name", "u.email");
  const responseSet = domainPlacementFilter("sp.form_placement_id", params.placementId, params.includeLegacyUnplaced);

  return {
    sql: `SELECT
       'proposal:' || sp.id AS id,
       'proposal' AS source,
       sp.id AS source_id,
       'proposal' AS context_type,
       sp.id AS context_ref,
       sp.status AS status,
       sp.submitted_at AS submitted_at,
       sp.proposer_user_id AS user_id,
       u.email AS user_email,
       u.first_name AS user_first_name,
       u.last_name AS user_last_name,
       u.organization_name AS user_organization,
       sp.details_json AS answers_json,
       ${submitter} AS submitter
     FROM session_proposals sp
     LEFT JOIN users u ON u.id = sp.proposer_user_id
     WHERE sp.event_id = ?
       AND ${responseSet.sql}
       AND sp.details_json IS NOT NULL
       ${status.sql}
       ${search.sql}
       AND NOT EXISTS (
         SELECT 1 FROM form_submissions fs2
         WHERE fs2.form_id = ? AND fs2.context_type = 'proposal' AND fs2.context_ref = sp.id
       )`,
    bindings: [params.eventId, ...responseSet.bindings, ...status.bindings, ...search.bindings, params.formId],
  };
}

function buildMergedSubmissionsQuery(params: {
  formId: string;
  placementId: string | null;
  includeLegacyUnplaced: boolean;
  status?: string;
  attendanceType?: string;
  q?: string;
  purpose: string;
  eventId: string | null;
  scopeNativeRowsToEvent: boolean;
}): Pick<FormSubmissionPopulation, "cte" | "bindings"> {
  const branches = [
    nativeSubmissionBranch({
      formId: params.formId,
      placementId: params.placementId,
      includeLegacyUnplaced: params.includeLegacyUnplaced,
      purpose: params.purpose,
      eventId: params.scopeNativeRowsToEvent ? params.eventId : null,
      status: params.status,
      attendanceType: params.attendanceType,
      q: params.q,
    }),
  ];

  if (params.eventId && params.purpose === "event_registration") {
    branches.push(
      legacyRegistrationBranch({
        eventId: params.eventId,
        formId: params.formId,
        placementId: params.placementId,
        includeLegacyUnplaced: params.includeLegacyUnplaced,
        status: params.status,
        attendanceType: params.attendanceType,
        q: params.q,
      }),
    );
  } else if (params.eventId && params.purpose === "proposal_submission") {
    branches.push(
      legacyProposalBranch({
        eventId: params.eventId,
        formId: params.formId,
        placementId: params.placementId,
        includeLegacyUnplaced: params.includeLegacyUnplaced,
        status: params.status,
        q: params.q,
      }),
    );
  }

  return {
    cte: `WITH merged AS (${branches.map((branch) => branch.sql).join(" UNION ALL ")})`,
    bindings: branches.flatMap((branch) => branch.bindings),
  };
}

export async function resolveFormSubmissionPopulation(
  db: DatabaseLike,
  params: FormSubmissionFilters,
): Promise<FormSubmissionPopulation> {
  const form = await getFormByKey(db, params.formKey);
  const requestedEvent = params.eventSlug ? await getEventBySlug(db, params.eventSlug) : null;
  const placement = await findFormPlacement(db, form.id, {
    ...(params.placementId ? { placementId: params.placementId } : {}),
    ...(!params.placementId && requestedEvent ? { contextType: "event" as const, contextRef: requestedEvent.id } : {}),
  });
  if (params.placementId && !placement) {
    throw new AppError(404, "FORM_PLACEMENT_NOT_FOUND", "The requested form response set was not found");
  }
  if (
    requestedEvent &&
    ((placement && (placement.contextType !== "event" || placement.contextRef !== requestedEvent.id)) ||
      (!placement && form.scope_type === "event" && form.scope_ref !== requestedEvent.id))
  ) {
    throw new AppError(400, "FORM_EVENT_SCOPE_MISMATCH", "The form does not belong to the requested event");
  }
  const eventId =
    requestedEvent?.id ??
    (placement?.contextType === "event" ? placement.contextRef : form.scope_type === "event" ? form.scope_ref : null);
  return {
    form,
    placement,
    ...buildMergedSubmissionsQuery({
      formId: form.id,
      placementId: placement?.id ?? null,
      includeLegacyUnplaced: Boolean(placement && !params.placementId),
      status: params.status,
      attendanceType: params.attendanceType,
      q: params.q,
      purpose: form.purpose,
      eventId,
      scopeNativeRowsToEvent: Boolean(params.eventSlug),
    }),
  };
}

export function selectFromSubmissionPopulation(
  population: FormSubmissionPopulation,
  selectSql: string,
  bindings: readonly unknown[] = [],
): PopulationQuery {
  return {
    sql: `${population.cte} ${selectSql}`,
    bindings: [...population.bindings, ...bindings],
  };
}

export function countSubmissionPopulation(population: FormSubmissionPopulation): PopulationQuery {
  return selectFromSubmissionPopulation(population, "SELECT COUNT(*) AS total FROM merged");
}
