import type { ValidatedData } from "chanfana";
import {
  adminProposalReviewsListRouteSchema,
  adminProposalReviewUpsertRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireAdminFromRequest, requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import { getConfig } from "../../../../../_lib/config";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { json } from "../../../../../_lib/http";
import { listProposalReviews, upsertProposalReview } from "../../../../../_lib/services/proposal-reviews";

export async function onRequestGet(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalReviewsListRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireAdminFromRequest(db, c.req.raw, c.env);
  const config = getConfig(c.env, c.req.raw);
  return json(
    await listProposalReviews(
      db,
      admin,
      data.params.proposalId,
      {
        q: data.query.q,
        sort: data.query.sort,
        recommendation: data.query.recommendation,
        limit: data.query.limit,
        offset: data.query.offset,
      },
      config.minProposalReviews,
    ),
  );
}

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminProposalReviewUpsertRouteSchema>,
): Promise<Response> {
  const db = requestDb(c);
  const admin = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const review = await upsertProposalReview(db, admin, data.params.proposalId, data.body);
  return json({ success: true, review });
}
