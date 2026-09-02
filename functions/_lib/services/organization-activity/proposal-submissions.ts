/**
 * The session proposals an organization's representatives submitted.
 *
 * One row per proposal, so the source is already cardinality-preserving: the
 * count keeps the same predicate and drops only the proposer join the
 * projection needs, which is the one thing the page adds.
 *
 * The status vocabulary — including its `active` aggregate — is the canonical
 * program-catalogue one; the predicate is the same shape
 * `functions/_lib/services/event-proposals-list.ts` uses, so "active" means
 * exactly one thing across the application.
 *
 * Gap, flagged rather than migrated (the same one
 * `proposal-current-user-read-model.ts` records): there is no index on
 * `session_proposals.proposer_user_id`, so the proposal side of this join is
 * an index scan rather than a seek. The organization side is selective and
 * indexed (`idx_identities_organization_lifecycle`) and the page is bounded,
 * so this is a cost note, not a correctness or unboundedness one. An index on
 * `proposer_user_id` would serve both read models and belongs in whichever
 * migration next touches proposals.
 */
import {
  ORGANIZATION_PROPOSALS_SORT_COLUMNS,
  organizationProposalsListResponseSchema,
  type OrganizationProposal,
  type OrganizationProposalsListQuery,
  type OrganizationProposalsListResponse,
} from "../../../../assets/shared/schemas/organization-activity";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { PROPOSAL_INACTIVE_STATUSES } from "../../../../assets/shared/schemas/proposal-status";
import { queryPage, type OffsetPageQuery } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import type { DatabaseLike } from "../../types";
import { ORGANIZATION_REPRESENTATIVE_USERS_CTE } from "./representative-users";

interface OrganizationProposalRow {
  proposal_id: string;
  event_slug: string;
  event_name: string;
  title: string;
  proposal_type: string;
  status: OrganizationProposal["status"];
  submitted_at: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  proposer_email: string;
}

const ORGANIZATION_PROPOSALS_WITH = `WITH ${ORGANIZATION_REPRESENTATIVE_USERS_CTE}`;

const ORGANIZATION_PROPOSALS_FROM = `FROM session_proposals proposal
  JOIN organization_representative_users representative ON representative.user_id = proposal.proposer_user_id
  JOIN events e ON e.id = proposal.event_id`;

const ORGANIZATION_PROPOSALS_SELECT = `SELECT proposal.id AS proposal_id, e.slug AS event_slug, e.name AS event_name,
         proposal.title, proposal.proposal_type, proposal.status, proposal.submitted_at,
         proposer.first_name AS proposer_first_name, proposer.last_name AS proposer_last_name,
         proposer.email AS proposer_email`;

const ORGANIZATION_PROPOSALS_SORT_EXPRESSIONS = {
  submittedAt: "proposal.submitted_at",
  title: "proposal.title COLLATE NOCASE",
  status: "proposal.status",
} satisfies Record<(typeof ORGANIZATION_PROPOSALS_SORT_COLUMNS)[number], string>;

/** Exported so `tests/admin-list-query-plans.test.ts` can assert the page/count pair. */
export function buildOrganizationProposalsPageQuery(
  organizationId: string,
  query: OrganizationProposalsListQuery,
): OffsetPageQuery {
  const conditions = ["proposal.deleted_at IS NULL"];
  const bindings: unknown[] = [organizationId];
  if (query.status === "active") {
    conditions.push(`proposal.status NOT IN (${PROPOSAL_INACTIVE_STATUSES.map(() => "?").join(", ")})`);
    bindings.push(...PROPOSAL_INACTIVE_STATUSES);
  } else if (query.status) {
    conditions.push("proposal.status = ?");
    bindings.push(query.status);
  }
  if (query.q) {
    const search = buildD1TextSearchFilter(query.q, ["proposal.title", "e.name"]);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const where = `\n WHERE ${conditions.join(" AND ")}`;

  return {
    source: {
      withSql: ORGANIZATION_PROPOSALS_WITH,
      selectSql: ORGANIZATION_PROPOSALS_SELECT,
      fromSql: `${ORGANIZATION_PROPOSALS_FROM}
  JOIN users proposer ON proposer.id = proposal.proposer_user_id${where}`,
      countFromSql: `${ORGANIZATION_PROPOSALS_FROM}${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      ORGANIZATION_PROPOSALS_SORT_EXPRESSIONS,
      `${ORGANIZATION_PROPOSALS_SORT_EXPRESSIONS.submittedAt} DESC`,
      "proposal.id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  };
}

function mapProposal(row: OrganizationProposalRow): OrganizationProposal {
  return {
    proposalId: row.proposal_id,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    title: row.title,
    proposalType: row.proposal_type,
    status: row.status,
    submittedAt: row.submitted_at,
    proposerName: [row.proposer_first_name, row.proposer_last_name].filter(Boolean).join(" ") || row.proposer_email,
    proposerEmail: row.proposer_email,
  };
}

export async function listOrganizationProposals(
  db: DatabaseLike,
  organizationId: string,
  query: OrganizationProposalsListQuery,
): Promise<OrganizationProposalsListResponse> {
  const { rows, total } = await queryPage<OrganizationProposalRow>(
    db,
    buildOrganizationProposalsPageQuery(organizationId, query),
  );
  return organizationProposalsListResponseSchema.parse({
    proposals: rows.map(mapProposal),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}
