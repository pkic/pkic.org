import {
  renewEvidencePurgeReview,
  resumeEvidencePurgeRun,
} from "../../../_lib/services/event-participation/retention-purge-resumption";
import {
  evidencePurgeRenewalReviewRouteSchema,
  evidencePurgeResumptionCreateRouteSchema,
  evidencePurgePreviewRouteSchema,
  evidencePurgeReviewCreateRouteSchema,
  evidencePurgeRunCreateRouteSchema,
  evidencePurgeRunReadRouteSchema,
  evidencePurgeChunkCreateRouteSchema,
} from "../../../../assets/shared/schemas/event-evidence-purge";
import { requireUserBackedAuthAdmin } from "../../../_lib/auth/admin-identity";
import { requireStaffPermission } from "../../../_lib/auth/staff-permissions";
import type { AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  evidencePurgePreview,
  createEvidencePurgeReview,
} from "../../../_lib/services/event-participation/retention-purge-review";
import {
  startEvidencePurgeRun,
  readPurgeRun,
  purgeRunResponse,
} from "../../../_lib/services/event-participation/retention-purge-runs";
import { commitEvidencePurgeChunk } from "../../../_lib/services/event-participation/retention-purge-chunks";
async function authority(c: AdminContext) {
  const { db, staff } = await requireStaffPermission(c, "retention:read");
  return { db, actor: requireUserBackedAuthAdmin(staff) };
}
export const EvidencePurgePreview = openApiRoute(evidencePurgePreviewRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await authority(c);
  return json(await evidencePurgePreview(db, actor, data.params.eventId));
});
export const EvidencePurgeReviewCreate = openApiRoute(
  evidencePurgeReviewCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await authority(c);
    return json(await createEvidencePurgeReview(db, actor, data.params.eventId, data.body));
  },
);
export const EvidencePurgeRunCreate = openApiRoute(evidencePurgeRunCreateRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await authority(c);
  return json(await startEvidencePurgeRun(db, actor, data.params.eventId, data.body));
});
export const EvidencePurgeRunRead = openApiRoute(evidencePurgeRunReadRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await authority(c);
  return json(purgeRunResponse(await readPurgeRun(db, actor, data.params.eventId, data.params.runId)));
});
export const EvidencePurgeChunkCreate = openApiRoute(
  evidencePurgeChunkCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await authority(c);
    return json(await commitEvidencePurgeChunk(db, actor, data.params.eventId, data.params.runId, data.body));
  },
);

export const EvidencePurgeRenewalReview = openApiRoute(
  evidencePurgeRenewalReviewRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await authority(c);
    return json(await renewEvidencePurgeReview(db, actor, data.params.eventId, data.params.runId, data.body));
  },
);
export const EvidencePurgeResumptionCreate = openApiRoute(
  evidencePurgeResumptionCreateRouteSchema,
  async (c: AdminContext, data) => {
    const { db, actor } = await authority(c);
    return json(await resumeEvidencePurgeRun(db, actor, data.params.eventId, data.params.runId, data.body));
  },
);
