import { buildPageInfo } from "../../../assets/shared/schemas/pagination";
import type {
  ProposalCommentsListQuery,
  ProposalInternalComment,
} from "../../../assets/shared/schemas/proposal-comments";
import { getProposalAccessForEvent } from "../auth/proposal-access";
import { queryPage } from "../db/pagination";
import { first } from "../db/queries";
import { buildD1TextSearchFilter } from "../db/search";
import { resolveMappedOrderBy } from "../db/sort";
import { AppError } from "../errors";
import type { AuthAdmin, DatabaseLike } from "../types";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { prepareAuditLog } from "./audit";

const COMMENT_COLUMNS = `pc.id, pc.proposal_id, pc.author_user_id, pc.comment,
  pc.created_at, pc.updated_at, u.email AS author_email,
  u.first_name AS author_first_name, u.last_name AS author_last_name`;

async function requireProposalCommentAccess(db: DatabaseLike, actor: AuthAdmin, proposalId: string): Promise<void> {
  const proposal = await first<{ event_id: string }>(
    db,
    "SELECT event_id FROM session_proposals WHERE id = ? AND deleted_at IS NULL",
    [proposalId],
  );
  if (!proposal) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const access = await getProposalAccessForEvent(db, proposal.event_id, actor);
  if (!access.canReview) {
    throw new AppError(403, "FORBIDDEN", "Missing permission to review proposal comments");
  }
}

export async function listProposalComments(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  query: ProposalCommentsListQuery & { limit: number; offset: number },
) {
  await requireProposalCommentAccess(db, actor, proposalId);
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["pc.comment", "u.email", "u.first_name", "u.last_name"])
    : null;
  const searchSql = search ? `AND ${search.sql}` : "";
  const bindings = [proposalId, ...(search?.bindings ?? [])];
  const from = `FROM proposal_internal_comments pc
    JOIN users u ON u.id = pc.author_user_id`;
  const orderBy = resolveMappedOrderBy(
    query.sort,
    {
      createdAt: "pc.created_at",
      author: "COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) COLLATE NOCASE",
    },
    "pc.created_at DESC",
    "pc.id ASC",
  );
  const { rows, total } = await queryPage<ProposalInternalComment>(db, {
    sql: `SELECT ${COMMENT_COLUMNS}
            ${from}
            WHERE pc.proposal_id = ? ${searchSql}
            `,
    bindings,
    orderBy,
    limit: query.limit,
    offset: query.offset,
  });
  return { comments: rows, page: buildPageInfo(query.limit, query.offset, total, rows.length) };
}

export async function addProposalComment(
  db: DatabaseLike,
  actor: AuthAdmin,
  proposalId: string,
  comment: string,
): Promise<ProposalInternalComment> {
  await requireProposalCommentAccess(db, actor, proposalId);
  const id = uuid();
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO proposal_internal_comments (
           id, proposal_id, author_user_id, comment, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, proposalId, actor.id, comment, now, now),
    prepareAuditLog(db, "admin", actor.id, "proposal_internal_comment_added", "proposal", proposalId, {
      commentId: id,
    }),
  ]);

  const created = await first<ProposalInternalComment>(
    db,
    `SELECT ${COMMENT_COLUMNS}
     FROM proposal_internal_comments pc
     JOIN users u ON u.id = pc.author_user_id
     WHERE pc.id = ?`,
    [id],
  );
  if (!created) throw new AppError(500, "PROPOSAL_COMMENT_CREATE_FAILED", "Unable to load the created comment");
  return created;
}
