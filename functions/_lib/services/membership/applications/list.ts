import {
  APPLICATION_SCOPE_STAGES,
  isApplicationTerminalStage,
} from "../../../../../assets/shared/schemas/member-applications";
import {
  MEMBERSHIP_APPLICATIONS_SORT_COLUMNS,
  membershipApplicationSummarySchema,
  type MembershipApplicationsListQuery,
  type MembershipApplicationSummary,
} from "../../../../../assets/shared/schemas/membership-application-management";
import { queryPage } from "../../../db/pagination";
import { buildD1TextSearchFilter } from "../../../db/search";
import { resolveMappedOrderBy } from "../../../db/sort";
import type { DatabaseLike } from "../../../types";
import type { MemberApplicationRow } from "./queries";
const MEMBERSHIP_APPLICATION_ORDER_COLUMNS: Record<(typeof MEMBERSHIP_APPLICATIONS_SORT_COLUMNS)[number], string> = {
  applicant_name: "ma.applicant_name",
  organization_name: "ma.organization_name",
  membership_category: "ma.membership_category",
  stage: "ma.stage",
  created_at: "ma.created_at",
  closed_at: "ma.stage_entered_at",
};

export type MembershipApplicationSummaryRow = Pick<
  MemberApplicationRow,
  | "id"
  | "applicant_email"
  | "applicant_name"
  | "organization_name"
  | "membership_category"
  | "stage"
  | "on_hold_subtype"
  | "assigned_to_user_id"
  | "created_at"
  | "updated_at"
  | "stage_entered_at"
>;

type MembershipApplicationManagementSummaryRow = MembershipApplicationSummaryRow & {
  membership_category_label: string;
  current_requirement: string | null;
  source_id: string | null;
  repository: string | null;
  issue_id: string | null;
  issue_number: number | null;
  issue_url: string | null;
  imported_at: string | null;
  activated_at: string | null;
  historical: number;
};

export function toSummary(
  row: MembershipApplicationSummaryRow,
  membershipCategoryLabel: string,
  currentRequirement: string | null = null,
): MembershipApplicationSummary {
  return membershipApplicationSummarySchema.parse({
    id: row.id,
    applicantEmail: row.applicant_email,
    applicantName: row.applicant_name,
    organizationName: row.organization_name,
    membershipCategory: row.membership_category,
    membershipCategoryLabel,
    currentRequirement,
    closedAt: isApplicationTerminalStage(row.stage) ? row.stage_entered_at : null,
    stage: row.stage,
    onHoldSubtype: row.on_hold_subtype,
    assignedToUserId: row.assigned_to_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export async function listMembershipApplications(
  db: DatabaseLike,
  params: MembershipApplicationsListQuery,
): Promise<{ applications: MembershipApplicationSummary[]; total: number }> {
  const stages = APPLICATION_SCOPE_STAGES[params.scope];
  const conditions: string[] = [`ma.stage IN (${stages.map(() => "?").join(",")})`];
  const values: unknown[] = [...stages];
  if (params.stage) {
    conditions.push("ma.stage = ?");
    values.push(params.stage);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, [
      "ma.applicant_name",
      "ma.applicant_email",
      "ma.organization_name",
      "ma.membership_category",
      "mc.label",
      "ma.applicant_name || ' ' || ma.applicant_email || ' ' || COALESCE(ma.organization_name, '') || ' ' || ma.membership_category || ' ' || mc.label",
    ]);
    conditions.push(search.sql);
    values.push(...search.bindings);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = resolveMappedOrderBy(
    params.sort,
    MEMBERSHIP_APPLICATION_ORDER_COLUMNS,
    "ma.created_at DESC",
    "ma.id ASC",
  );

  const { rows, total } = await queryPage<MembershipApplicationManagementSummaryRow>(db, {
    sql: `WITH applications AS (
      SELECT ma.id, ma.applicant_email, ma.applicant_name, ma.organization_name,
        ma.membership_category, ma.stage, ma.on_hold_subtype, ma.assigned_to_user_id,
        ma.created_at, ma.updated_at, ma.stage_entered_at,
        source.id AS source_id, source.repository, source.issue_id, source.issue_number,
        source.issue_url, source.imported_at, source.activated_at, 0 AS historical
      FROM member_applications ma LEFT JOIN membership_application_sources source ON source.application_id = ma.id
      UNION ALL
      SELECT source.id, COALESCE(source.applicant_email, ''), COALESCE(source.applicant_name, 'Unknown applicant'), source.organization_name,
        COALESCE(source.category_code, ''), source.outcome, NULL, NULL,
        source.source_created_at, source.source_updated_at, source.closed_at,
        source.id, source.repository, source.issue_id, source.issue_number,
        source.issue_url, source.imported_at, source.activated_at, 1
      FROM membership_application_sources source WHERE source.application_id IS NULL
    ) SELECT ma.id, ma.applicant_email, ma.applicant_name, ma.organization_name,
                   ma.membership_category, COALESCE(mc.label, 'Unknown category') AS membership_category_label,
                   ma.stage, ma.on_hold_subtype, ma.assigned_to_user_id,
                   ma.created_at, ma.updated_at, ma.stage_entered_at,
                   ma.source_id, ma.repository, ma.issue_id, ma.issue_number, ma.issue_url,
                   ma.imported_at, ma.activated_at, ma.historical,
                   CASE WHEN ma.stage IN ('submitted', 'processing', 'on_hold')
                     THEN json_extract(version.definition_json, '$.steps[' || workflow.current_position || '].label')
                     ELSE NULL END AS current_requirement
            FROM applications ma
            LEFT JOIN membership_categories mc ON mc.code = ma.membership_category
            LEFT JOIN membership_application_workflows workflow ON workflow.application_id = ma.id AND workflow.superseded_at IS NULL
            LEFT JOIN membership_workflow_versions version ON version.id = workflow.version_id ${where}`,
    bindings: values,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });

  return {
    applications: rows.map((row) =>
      membershipApplicationSummarySchema.parse({
        ...toSummary(row, row.membership_category_label, row.current_requirement),
        closedAt: row.historical
          ? row.stage_entered_at
          : isApplicationTerminalStage(row.stage)
            ? row.stage_entered_at
            : null,
        source: row.source_id
          ? {
              repository: row.repository,
              issueId: row.issue_id,
              issueNumber: row.issue_number,
              issueUrl: row.issue_url,
              importedAt: row.imported_at,
              activatedAt: row.activated_at,
              historical: Boolean(row.historical),
            }
          : null,
      }),
    ),
    total,
  };
}
