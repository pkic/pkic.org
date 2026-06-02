import { z } from "zod";
import { json } from "../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getProposalAccessForEvent } from "../../../../../_lib/auth/proposal-access";
import { all, first, run } from "../../../../../_lib/db/queries";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { parseJsonBody } from "../../../../../_lib/validation";
import { writeAuditLog } from "../../../../../_lib/services/audit";
import { uuid } from "../../../../../_lib/utils/ids";
import { nowIso } from "../../../../../_lib/utils/time";

const proposalCommentCreateSchema = z.object({
  comment: z.string().trim().min(1).max(10_000),
});

interface ProposalCommentRow {
  id: string;
  proposal_id: string;
  author_user_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
  author_email: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
}

type ProposalCommentAccessContext =
  | { ok: false; response: Response }
  | {
      ok: true;
      admin: Awaited<ReturnType<typeof requireAdminFromRequest>>;
      proposal: { id: string; event_id: string };
    };

async function requireProposalCommentAccess(c: AdminContext): Promise<ProposalCommentAccessContext> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const proposal = await first<{ id: string; event_id: string }>(
    requestDb(c),
    "SELECT id, event_id FROM session_proposals WHERE id = ?",
    [c.req.param("proposalId")],
  );
  if (!proposal) {
    return { ok: false, response: json({ error: { code: "PROPOSAL_NOT_FOUND", message: "Proposal not found" } }, 404) };
  }

  const access = await getProposalAccessForEvent(requestDb(c), proposal.event_id, admin);
  if (!access.canReview) {
    return {
      ok: false,
      response: json({ error: { code: "FORBIDDEN", message: "Missing permission to view comments" } }, 403),
    };
  }

  return { ok: true, admin, proposal };
}

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const context = await requireProposalCommentAccess(c);
  if (!context.ok) return context.response;

  const comments = await all<ProposalCommentRow>(
    requestDb(c),
    `SELECT
       pc.*,
       u.email AS author_email,
       u.first_name AS author_first_name,
       u.last_name AS author_last_name
     FROM proposal_internal_comments pc
     JOIN users u ON u.id = pc.author_user_id
     WHERE pc.proposal_id = ?
     ORDER BY pc.created_at DESC`,
    [context.proposal.id],
  );

  return json({ comments });
}

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const context = await requireProposalCommentAccess(c);
  if (!context.ok) return context.response;

  const body = await parseJsonBody(c.req, proposalCommentCreateSchema);
  const now = nowIso();
  const id = uuid();

  await run(
    requestDb(c),
    `INSERT INTO proposal_internal_comments (
      id, proposal_id, author_user_id, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, context.proposal.id, context.admin.id, body.comment, now, now],
  );

  await writeAuditLog(
    requestDb(c),
    "admin",
    context.admin.id,
    "proposal_internal_comment_added",
    "proposal",
    context.proposal.id,
    {
      commentId: id,
      adminEmail: context.admin.email,
    },
  );

  const comment = await first<ProposalCommentRow>(
    requestDb(c),
    `SELECT
       pc.*,
       u.email AS author_email,
       u.first_name AS author_first_name,
       u.last_name AS author_last_name
     FROM proposal_internal_comments pc
     JOIN users u ON u.id = pc.author_user_id
     WHERE pc.id = ?`,
    [id],
  );

  return json({ success: true, comment });
}
