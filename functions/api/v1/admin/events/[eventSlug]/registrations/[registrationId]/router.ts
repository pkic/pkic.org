import { Hono } from "hono";
import { fromHono } from "chanfana";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { adminRegistrationBadgeRegenerationRouteSchema } from "../../../../../../../../assets/shared/schemas/route-contracts";
import { AdminRegistrationAdmit } from "./admit";
import { AdminRegistrationAuditLogGet } from "./audit-log";
import { AdminRegistrationBadgeRoleGet, AdminRegistrationBadgeRolePatch } from "./badge-role";
import { AdminRegistrationDayAttendancePatch } from "./day-attendance";
import { AdminRegistrationDetailGet, AdminRegistrationPatch } from "./index";
import { AdminRegistrationOpenManage } from "./open-manage";
import { onRequestPost as AdminEventsEventSlugRegistrationsRegistrationIdRegenerateBadgePost_l } from "./regenerate-badge";
import { AdminRegistrationResendConfirmation } from "./resend-confirmation";
import type { RequestDbContext } from "../../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/admit", AdminRegistrationAdmit);
openapi.get("/audit-log", AdminRegistrationAuditLogGet);
openapi.get("/badge-role", AdminRegistrationBadgeRoleGet);
openapi.patch("/badge-role", AdminRegistrationBadgeRolePatch);
openapi.patch("/day-attendance", AdminRegistrationDayAttendancePatch);
openapi.get("/", AdminRegistrationDetailGet);
openapi.patch("/", AdminRegistrationPatch);
openapi.post("/open-manage", AdminRegistrationOpenManage);
openapi.post(
  "/regenerate-badge",
  openApiRoute(
    adminRegistrationBadgeRegenerationRouteSchema,
    AdminEventsEventSlugRegistrationsRegistrationIdRegenerateBadgePost_l,
  ),
);
openapi.post("/resend-confirmation", AdminRegistrationResendConfirmation);

export default openapi;
