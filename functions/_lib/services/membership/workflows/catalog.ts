import {
  membershipWorkflowVersionSchema,
  type MembershipWorkflowsQuery,
  type MembershipWorkflowVersion,
} from "../../../../../assets/shared/schemas/membership-workflows";
import { buildPageInfo } from "../../../../../assets/shared/schemas/pagination";
import { first } from "../../../db/queries";
import { queryPage } from "../../../db/pagination";
import { buildD1TextSearchFilter } from "../../../db/search";
import { resolveMappedOrderBy } from "../../../db/sort";
import { AppError } from "../../../errors";
import type { DatabaseLike } from "../../../types";

interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  revision: number;
  status: string;
  definition_json: string;
  created_at: string;
  published_at: string | null;
}
const VERSION_SELECT = `SELECT version.id, version.workflow_id, version.version, version.revision,
  version.status, version.definition_json, version.created_at, version.published_at`;
function toWorkflowVersion(row: WorkflowVersionRow): MembershipWorkflowVersion {
  return membershipWorkflowVersionSchema.parse({
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    revision: row.revision,
    status: row.status,
    definition: JSON.parse(row.definition_json),
    createdAt: row.created_at,
    publishedAt: row.published_at,
  });
}
export async function getMembershipWorkflowVersion(db: DatabaseLike, id: string): Promise<MembershipWorkflowVersion> {
  const row = await first<WorkflowVersionRow>(
    db,
    `${VERSION_SELECT} FROM membership_workflow_versions version WHERE version.id = ?`,
    [id],
  );
  if (!row) throw new AppError(404, "MEMBERSHIP_WORKFLOW_NOT_FOUND", "Membership workflow version not found");
  return toWorkflowVersion(row);
}
export async function listMembershipWorkflowVersions(db: DatabaseLike, query: MembershipWorkflowsQuery) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (query.status) {
    clauses.push("version.status = ?");
    bindings.push(query.status);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["version.name"]);
    clauses.push(search.sql);
    bindings.push(...search.bindings);
  }
  const result = await queryPage<WorkflowVersionRow>(db, {
    source: {
      selectSql: VERSION_SELECT,
      fromSql: `FROM membership_workflow_versions version${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { name: "version.name", createdAt: "version.created_at", version: "version.version" },
      "version.name ASC, version.version DESC",
      "version.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return {
    workflows: result.rows.map(toWorkflowVersion),
    page: buildPageInfo(query.limit, query.offset, result.total, result.rows.length),
  };
}
