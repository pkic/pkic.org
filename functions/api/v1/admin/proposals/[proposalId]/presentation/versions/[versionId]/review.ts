import { json } from "../../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../../_lib/auth/admin";
import { reviewPresentationVersion } from "../../../../../../../../_lib/services/presentation-versions";
import { requestDb, type AdminContext } from "../../../../../../../../_lib/db/context";
import type { PresentationVersionReviewRequest } from "../../../../../../../../../assets/shared/schemas/presentation-versions";
import type { ValidatedData } from "chanfana";
import { adminPresentationVersionReviewRouteSchema } from "../../../../../../../../../assets/shared/schemas/route-contracts";

export async function onRequestPost(
  c: AdminContext,
  data: ValidatedData<typeof adminPresentationVersionReviewRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);

  const { proposalId, versionId } = data.params;
  const updated = await reviewPresentationVersion(
    requestDb(c),
    proposalId,
    versionId,
    admin.id,
    data.body as PresentationVersionReviewRequest,
  );
  return json({ version: updated });
}
