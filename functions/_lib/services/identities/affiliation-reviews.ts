/**
 * Read models for the organization names and titles the identity migration
 * could not attach to an identity, grouped the way staff decide them: one
 * group per fuzzy name key (see affiliation-review-decisions.ts).
 */
import { first } from "../../db/queries";
import { queryPage } from "../../db/pagination";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import {
  affiliationReviewGroupSchema,
  affiliationReviewSchema,
  type AffiliationReview,
  type AffiliationReviewGroup,
  type AffiliationReviewGroupsListQuery,
  type AffiliationReviewStatus,
  type AffiliationReviewsListQuery,
} from "../../../../assets/shared/schemas/affiliation-reviews";

interface ReviewRow {
  id: string;
  group_key: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  organization_name: string | null;
  job_title: string | null;
  email_domain: string | null;
  source_type: string;
  resolved_identity_id: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface GroupRow {
  group_key: string;
  organization_name: string | null;
  job_title: string | null;
  email_domains: string | null;
  people: number;
  open_reviews: number;
  resolved_reviews: number;
  first_recorded_at: string;
}

const PERSON_NAME_SQL =
  "LOWER(COALESCE(NULLIF(TRIM(COALESCE(person.first_name, '') || ' ' || COALESCE(person.last_name, '')), ''), person.email))";

const STATUS_CONDITIONS = {
  open: "review.resolved_at IS NULL",
  resolved: "review.resolved_identity_id IS NOT NULL",
  dismissed: "review.resolved_at IS NOT NULL AND review.resolved_identity_id IS NULL",
} as const;

const SEARCH_COLUMNS = [
  "review.organization_name",
  "review.job_title",
  "review.email_domain",
  "person.email",
  "person.first_name",
  "person.last_name",
];

function toReview(row: ReviewRow): AffiliationReview {
  return affiliationReviewSchema.parse({
    id: row.id,
    groupKey: row.group_key,
    userId: row.user_id,
    personName: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    personEmail: row.email,
    organizationName: row.organization_name,
    jobTitle: row.job_title,
    emailDomain: row.email_domain,
    sourceType: row.source_type,
    status: row.resolved_at === null ? "open" : row.resolved_identity_id ? "resolved" : "dismissed",
    resolvedIdentityId: row.resolved_identity_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  });
}

function toGroup(row: GroupRow, status: AffiliationReviewStatus): AffiliationReviewGroup {
  return affiliationReviewGroupSchema.parse({
    groupKey: row.group_key,
    organizationName: row.organization_name,
    jobTitle: row.organization_name === null ? row.job_title : null,
    emailDomains: row.email_domains ? row.email_domains.split(",").sort() : [],
    people: Number(row.people),
    openReviews: Number(row.open_reviews),
    status,
    firstRecordedAt: row.first_recorded_at,
  });
}

/** One group's summary over the rows `conditions` select. The spelling is the group's most written one. */
function groupSelect(conditions: string[]): string {
  return `SELECT review.group_key,
      (SELECT spelling.organization_name FROM affiliation_reviews spelling
        WHERE spelling.group_key = review.group_key AND spelling.organization_name IS NOT NULL
        GROUP BY spelling.organization_name
        ORDER BY COUNT(*) DESC, spelling.organization_name LIMIT 1) AS organization_name,
      MIN(review.job_title) AS job_title,
      group_concat(DISTINCT review.email_domain) AS email_domains,
      COUNT(DISTINCT review.user_id) AS people,
      (SELECT COUNT(*) FROM affiliation_reviews open_review
        WHERE open_review.group_key = review.group_key AND open_review.resolved_at IS NULL) AS open_reviews,
      SUM(review.resolved_identity_id IS NOT NULL) AS resolved_reviews,
      MIN(review.created_at) AS first_recorded_at
    FROM affiliation_reviews review
    JOIN users person ON person.id = review.user_id
   WHERE ${conditions.join(" AND ")}
   GROUP BY review.group_key`;
}

export async function listAffiliationReviewGroups(db: DatabaseLike, params: AffiliationReviewGroupsListQuery) {
  const status = params.status ?? "open";
  const conditions: string[] = [STATUS_CONDITIONS[status]];
  const bindings: unknown[] = [];
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, SEARCH_COLUMNS);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveMappedOrderBy(
    params.sort,
    {
      people: "people",
      organizationName: "LOWER(COALESCE(organization_name, job_title, ''))",
      firstRecordedAt: "first_recorded_at",
    },
    "people DESC",
    "group_key ASC",
  );
  const { rows, total } = await queryPage<GroupRow>(db, {
    sql: groupSelect(conditions),
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { groups: rows.map((row) => toGroup(row, status)), total };
}

export async function getAffiliationReviewGroup(db: DatabaseLike, groupKey: string): Promise<AffiliationReviewGroup> {
  const row = await first<GroupRow>(db, groupSelect(["review.group_key = ?"]), [groupKey]);
  if (!row) throw new AppError(404, "NOT_FOUND", "Review group not found");
  const status: AffiliationReviewStatus =
    Number(row.open_reviews) > 0 ? "open" : Number(row.resolved_reviews) > 0 ? "resolved" : "dismissed";
  return toGroup(row, status);
}

export async function listAffiliationReviews(db: DatabaseLike, params: AffiliationReviewsListQuery) {
  const conditions: string[] = [STATUS_CONDITIONS[params.status ?? "open"]];
  const bindings: unknown[] = [];
  if (params.groupKey) {
    conditions.push("review.group_key = ?");
    bindings.push(params.groupKey);
  }
  if (params.q) {
    const search = buildD1TextSearchFilter(params.q, SEARCH_COLUMNS);
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  const orderBy = resolveMappedOrderBy(
    params.sort,
    { createdAt: "review.created_at", personName: PERSON_NAME_SQL },
    "review.created_at ASC",
    "review.id ASC",
  );
  const { rows, total } = await queryPage<ReviewRow>(db, {
    sql: `SELECT review.id, review.group_key, review.user_id, person.first_name, person.last_name, person.email,
                 review.organization_name, review.job_title, review.email_domain, review.source_type,
                 review.resolved_identity_id, review.created_at, review.resolved_at
            FROM affiliation_reviews review
            JOIN users person ON person.id = review.user_id
           WHERE ${conditions.join(" AND ")}`,
    bindings,
    orderBy,
    limit: params.limit,
    offset: params.offset,
  });
  return { reviews: rows.map(toReview), total };
}
