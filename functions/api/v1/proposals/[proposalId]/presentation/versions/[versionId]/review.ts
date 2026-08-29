import { json } from "../../../../../../../_lib/http";
import { requireUserBackedAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { reviewPresentationVersion } from "../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  presentationVersionResponseSchema,
  type PresentationVersionReviewRequest,
} from "../../../../../../../../assets/shared/schemas/presentation-versions";
import type { ValidatedData } from "chanfana";
import { proposalPresentationVersionReviewRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof proposalPresentationVersionReviewRouteSchema>,
): Promise<Response> {
  const admin = await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { proposalId, versionId } = data.params;
  const updated = await reviewPresentationVersion(
    requestDb(c),
    proposalId,
    versionId,
    admin,
    data.body as PresentationVersionReviewRequest,
  );
  return json(presentationVersionResponseSchema.parse({ version: updated }));
}
