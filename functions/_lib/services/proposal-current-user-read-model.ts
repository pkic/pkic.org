/**
 * Identity-first, READ-ONLY participation feed: every proposal the caller
 * submitted or is a listed speaker on (see IMPLEMENTATION_TRACKER.md section
 * 13). Mirrors the shape of `event-series/member-read-model.ts`'s
 * `listUpcomingMeetingsForMember`.
 *
 * CRITICAL BOUNDARY: never select `manage_token_hash` (session_proposals) or
 * `manage_token_hash` (proposal_speakers) here, or any other capability
 * field — see the schema file's header comment. This projection has no
 * write path.
 *
 * Both `session_proposals.proposer_user_id` and `proposal_speakers.user_id`
 * are `NOT NULL` — proposal submission always finds-or-creates a user row
 * before writing either (see `proposal-submission.ts`) — and
 * `users.normalized_email` is globally unique, so (as with `registrations`)
 * there is no email-fallback branch to write; user-id matching is complete.
 *
 * Gap: there is no index on `session_proposals.proposer_user_id`. The
 * `proposer_user_id = ?` branch is a plain table scan (confirmed by EXPLAIN
 * QUERY PLAN: `SCAN sp`); the closest existing access path is the
 * `UNIQUE(proposal_id, user_id)` auto-index on `proposal_speakers`, which the
 * `EXISTS` branch's correlated subquery uses (`SEARCH ps USING COVERING
 * INDEX sqlite_autoindex_proposal_speakers_2`). That branch also covers the
 * common case, since submitting a proposal always adds the proposer as a
 * `proposal_speakers` row too. Flagging rather than adding a migration per
 * repository policy.
 */
import {
  currentUserProposalSchema,
  type CurrentUserProposal,
  type CurrentUserProposalsListQuery,
} from "../../../assets/shared/schemas/current-user-proposals";
import type { OffsetPageQuery } from "../db/pagination";
import { queryPage } from "../db/pagination";
import type { DatabaseLike } from "../types";

interface CurrentUserProposalRow {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  event_id: string;
  event_slug: string;
  event_name: string;
  role: "submitter" | "speaker";
}

function toCurrentUserProposal(row: CurrentUserProposalRow): CurrentUserProposal {
  return currentUserProposalSchema.parse({
    id: row.id,
    event: { id: row.event_id, slug: row.event_slug, name: row.event_name },
    title: row.title,
    status: row.status,
    role: row.role,
    updatedAt: row.updated_at,
  });
}

/** Canonical page/count query, also used by the D1 EXPLAIN plan regression test. */
export function buildCurrentUserProposalsPageQuery(
  userId: string,
  query: CurrentUserProposalsListQuery,
): OffsetPageQuery {
  return {
    sql: `SELECT sp.id AS id, sp.title AS title, sp.status AS status, sp.updated_at AS updated_at,
            e.id AS event_id, e.slug AS event_slug, e.name AS event_name,
            CASE WHEN sp.proposer_user_id = ? THEN 'submitter' ELSE 'speaker' END AS role
          FROM session_proposals sp
          JOIN events e ON e.id = sp.event_id
          WHERE sp.proposer_user_id = ?
             OR EXISTS (
                  SELECT 1 FROM proposal_speakers ps
                   WHERE ps.proposal_id = sp.id AND ps.user_id = ?
                )`,
    bindings: [userId, userId, userId],
    orderBy: "ORDER BY sp.updated_at DESC, sp.id ASC",
    limit: query.limit,
    offset: query.offset,
  };
}

export async function listCurrentUserProposals(
  db: DatabaseLike,
  userId: string,
  query: CurrentUserProposalsListQuery,
): Promise<{ proposals: CurrentUserProposal[]; total: number }> {
  const { rows, total } = await queryPage<CurrentUserProposalRow>(
    db,
    buildCurrentUserProposalsPageQuery(userId, query),
  );
  return { proposals: rows.map(toCurrentUserProposal), total };
}
