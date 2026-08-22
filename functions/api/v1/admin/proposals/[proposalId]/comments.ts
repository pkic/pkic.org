import type { ValidatedData } from "chanfana";
import {
  adminProposalCommentCreateRouteSchema,
  adminProposalCommentsListRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest, requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { addProposalComment, listProposalComments } from "../../../../../_lib/services/proposal-comments";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalCommentsListRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(
    await listProposalComments(db, admin, data.params.proposalId, {
      q: data.query.q,
      sort: data.query.sort,
      limit: data.query.limit,
      offset: data.query.offset,
    }),
  );
}

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalCommentCreateRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const comment = await addProposalComment(db, admin, data.params.proposalId, data.body.comment);
  return json({ success: true, comment });
}
