import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { SystemAuditLogList } from "./audit-log";
import {
  SystemOrganizationContentReviewApprove,
  SystemOrganizationContentReviewGet,
  SystemOrganizationContentReviewReject,
  SystemOrganizationContentReviewsList,
} from "./organization-content-reviews";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/audit-log", SystemAuditLogList);
openapi.get("/organization-content-reviews", SystemOrganizationContentReviewsList);
openapi.get("/organization-content-reviews/:id", SystemOrganizationContentReviewGet);
openapi.post("/organization-content-reviews/:id/approve", SystemOrganizationContentReviewApprove);
openapi.post("/organization-content-reviews/:id/reject", SystemOrganizationContentReviewReject);

export default openapi;
