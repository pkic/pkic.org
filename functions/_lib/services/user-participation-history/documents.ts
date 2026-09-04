/**
 * The presentation documents a person contributed to.
 *
 * "Contributed to" is exactly the two things this schema records against a
 * person and a document: `presentation_versions.uploaded_by_user_id`, set
 * when they upload a version, and
 * `presentation_version_reviews.reviewed_by_user_id`, set when they review
 * one. Both are direct, attributable columns, so neither has to be inferred.
 *
 * Nothing else is treated as a document contribution. Proposing the session
 * or being listed as one of its speakers puts a person on the proposal, not
 * on the file, and crediting them for a document they never touched would
 * make this history less true rather than fuller. Versions whose upload
 * predates the versioned table carry a NULL uploader and simply do not match.
 *
 * Soft-deleted versions and proposals are excluded on both sides: the
 * document is gone, and a review of a withdrawn file is not a contribution a
 * record should still be showing.
 */
import {
  userDocumentContributionListResponseSchema,
  type ParticipationDocumentContribution,
  type ParticipationHistoryListQuery,
  type UserDocumentContribution,
  type UserDocumentContributionListResponse,
} from "../../../../assets/shared/schemas/user-participation-history";
import type { PresentationReviewStatus } from "../../../../assets/shared/schemas/presentation-versions";
import type { OffsetPageQuery } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { buildParticipationHistoryPageQuery, loadParticipationHistoryPage } from "./history-page";

interface DocumentContributionRow {
  contribution_id: string;
  contribution: ParticipationDocumentContribution;
  version_id: string;
  version_number: number;
  file_name: string | null;
  proposal_id: string;
  proposal_title: string;
  event_slug: string;
  event_name: string;
  review_status: PresentationReviewStatus | null;
  occurred_at: string;
}

const LIVE_DOCUMENT = "version.deleted_at IS NULL\n     AND proposal.deleted_at IS NULL";

const DOCUMENT_CONTEXT_JOINS = `JOIN session_proposals proposal ON proposal.id = version.proposal_id
    JOIN events event ON event.id = proposal.event_id`;

/**
 * Uploads and reviews are unioned into one collection so a person who both
 * supplied a deck and reviewed somebody else's sees one chronological list,
 * with `contribution` saying which act each line was. The union carries the
 * source row's own id, so the two acts on the same version stay distinct.
 */
const DOCUMENT_CONTRIBUTIONS_WITH = `WITH document_contributions AS (
  SELECT version.id AS contribution_id, 'upload' AS contribution, version.id AS version_id,
         version.version_number, version.file_name,
         proposal.id AS proposal_id, proposal.title AS proposal_title,
         event.slug AS event_slug, event.name AS event_name,
         NULL AS review_status, version.uploaded_at AS occurred_at
    FROM presentation_versions version
    ${DOCUMENT_CONTEXT_JOINS}
   WHERE version.uploaded_by_user_id = ?
     AND ${LIVE_DOCUMENT}
  UNION ALL
  SELECT review.id, 'review', version.id,
         version.version_number, version.file_name,
         proposal.id, proposal.title,
         event.slug, event.name,
         review.status, review.reviewed_at
    FROM presentation_version_reviews review
    JOIN presentation_versions version ON version.id = review.version_id
    ${DOCUMENT_CONTEXT_JOINS}
   WHERE review.reviewed_by_user_id = ?
     AND ${LIVE_DOCUMENT}
)`;

/** Exported so `tests/user-participation-history.test.ts` can assert the page/count pair. */
export function buildUserDocumentContributionPageQuery(
  userId: string,
  query: ParticipationHistoryListQuery,
): OffsetPageQuery {
  return buildParticipationHistoryPageQuery(query, {
    withSql: DOCUMENT_CONTRIBUTIONS_WITH,
    selectSql: `SELECT contribution_id, contribution, version_id, version_number, file_name,
         proposal_id, proposal_title, event_slug, event_name, review_status, occurred_at`,
    fromSql: "FROM document_contributions",
    conditions: [],
    bindings: [userId, userId],
    searchColumns: ["proposal_title", "file_name", "event_name"],
    occurredAtExpression: "occurred_at",
    tieBreaker: "contribution_id ASC",
  });
}

function toDocumentContribution(row: DocumentContributionRow): UserDocumentContribution {
  return {
    contributionId: row.contribution_id,
    contribution: row.contribution,
    versionId: row.version_id,
    versionNumber: row.version_number,
    fileName: row.file_name,
    proposalId: row.proposal_id,
    proposalTitle: row.proposal_title,
    eventSlug: row.event_slug,
    eventName: row.event_name,
    reviewStatus: row.review_status,
    occurredAt: row.occurred_at,
  };
}

export async function listUserDocumentContributions(
  db: DatabaseLike,
  userId: string,
  query: ParticipationHistoryListQuery,
): Promise<UserDocumentContributionListResponse> {
  return userDocumentContributionListResponseSchema.parse(
    await loadParticipationHistoryPage<DocumentContributionRow, UserDocumentContribution>(
      db,
      "documents",
      buildUserDocumentContributionPageQuery(userId, query),
      toDocumentContribution,
    ),
  );
}
