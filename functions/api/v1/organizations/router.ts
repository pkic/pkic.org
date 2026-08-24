import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { RepresentationDomainAssessment, RepresentationReconcile } from "./representation";
import {
  OrganizationRepresentativesList,
  OrganizationRepresentativeAssociate,
} from "./[organizationId]/representatives";
import {
  OrganizationRepresentativeBlock,
  OrganizationRepresentativeRestore,
} from "./[organizationId]/representatives/[userId]";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/representation-domain-assessment", RepresentationDomainAssessment);
openapi.post("/representation-reconciliation", RepresentationReconcile);
openapi.get("/:organizationId/representatives", OrganizationRepresentativesList);
openapi.post("/:organizationId/representatives", OrganizationRepresentativeAssociate);
openapi.delete("/:organizationId/representatives/:userId", OrganizationRepresentativeBlock);
openapi.post("/:organizationId/representatives/:userId/restore", OrganizationRepresentativeRestore);

export default openapi;
