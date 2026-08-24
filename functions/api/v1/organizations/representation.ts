import { requireRepresentativeManagerActor } from "../../../_lib/auth/organization-representation-access";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { json } from "../../../_lib/http";
import { openApiRoute } from "../../../_lib/openapi/route";
import {
  assessRepresentationDomain,
  reconcileVerifiedDomainRepresentations,
} from "../../../_lib/services/organization-representations";
import {
  representationDomainAssessmentRouteSchema,
  representationReconcileRouteSchema,
} from "../../../../assets/shared/schemas/route-contracts-organization-representations";

export const RepresentationDomainAssessment = openApiRoute(
  representationDomainAssessmentRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
    return json(await assessRepresentationDomain(db, actor.userId, data.query.email));
  },
);

export const RepresentationReconcile = openApiRoute(representationReconcileRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const actor = await requireRepresentativeManagerActor(db, c.req.raw, c.env);
  return json({ representativeIds: await reconcileVerifiedDomainRepresentations(db, actor.userId) });
});
