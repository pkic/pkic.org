import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import {
  OrganizationContentReviewApprove,
  OrganizationContentReviewGet,
  OrganizationContentReviewReject,
  OrganizationContentReviewsList,
} from "./content-reviews";
import { OrganizationCreate, OrganizationsList } from "./index";
import organizationIdRouter from "./[organizationId]/router";
import organizationIdentitiesRouter from "./[organizationId]/identities/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/content-reviews", OrganizationContentReviewsList);
openapi.get("/content-reviews/:id", OrganizationContentReviewGet);
openapi.post("/content-reviews/:id/approve", OrganizationContentReviewApprove);
openapi.post("/content-reviews/:id/reject", OrganizationContentReviewReject);
openapi.get("/", OrganizationsList);
openapi.post("/", OrganizationCreate);
openapi.route("/:organizationId/identities", organizationIdentitiesRouter);
openapi.route("/:organizationId", organizationIdRouter);

export default openapi;
