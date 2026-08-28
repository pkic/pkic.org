import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import membershipApplications_Router from "./membership-applications/router";
import { SystemMembershipCategoriesList, SystemMembershipCategoryUpdate } from "./membership-categories";
import { SystemMembershipSettingsGet, SystemMembershipSettingsUpdate } from "./membership-settings";
import { SystemAuditLogList } from "./audit-log";
import { EmailTemplatesList } from "./email-templates";
import emailTemplates_Router from "./email-templates/router";
import {
  SystemOrganizationContentReviewApprove,
  SystemOrganizationContentReviewGet,
  SystemOrganizationContentReviewReject,
  SystemOrganizationContentReviewsList,
} from "./organization-content-reviews";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/audit-log", SystemAuditLogList);
openapi.get("/email-templates", EmailTemplatesList);
openapi.route("/email-templates", emailTemplates_Router);
openapi.get("/membership-categories", SystemMembershipCategoriesList);
openapi.patch("/membership-categories/:categoryCode", SystemMembershipCategoryUpdate);
openapi.get("/membership-settings", SystemMembershipSettingsGet);
openapi.patch("/membership-settings", SystemMembershipSettingsUpdate);
openapi.route("/membership-applications", membershipApplications_Router);
openapi.get("/organization-content-reviews", SystemOrganizationContentReviewsList);
openapi.get("/organization-content-reviews/:id", SystemOrganizationContentReviewGet);
openapi.post("/organization-content-reviews/:id/approve", SystemOrganizationContentReviewApprove);
openapi.post("/organization-content-reviews/:id/reject", SystemOrganizationContentReviewReject);

export default openapi;
