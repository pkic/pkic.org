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
  OrganizationRepresentativeUpdate,
} from "./[organizationId]/representatives/[userId]";
import { OrganizationCreate, OrganizationsList } from "./index";
import organizationIdRouter from "./[organizationId]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/representation-domain-assessment", RepresentationDomainAssessment);
openapi.post("/representation-reconciliation", RepresentationReconcile);
openapi.get("/", OrganizationsList);
openapi.post("/", OrganizationCreate);
openapi.get("/:organizationId/representatives", OrganizationRepresentativesList);
openapi.post("/:organizationId/representatives", OrganizationRepresentativeAssociate);
openapi.patch("/:organizationId/representatives/:userId", OrganizationRepresentativeUpdate);
openapi.delete("/:organizationId/representatives/:userId", OrganizationRepresentativeBlock);
openapi.post("/:organizationId/representatives/:userId/restore", OrganizationRepresentativeRestore);
openapi.route("/:organizationId", organizationIdRouter);

export default openapi;
