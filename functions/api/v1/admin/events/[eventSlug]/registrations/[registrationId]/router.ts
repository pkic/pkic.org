import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEventsEventSlugRegistrationsRegistrationIdAdmitPost_l } from "./admit";
import { onRequestGet as AdminEventsEventSlugRegistrationsRegistrationIdAuditLogGet_l } from "./audit-log";
import { onRequestGet as AdminEventsEventSlugRegistrationsRegistrationIdBadgeRoleGet_l } from "./badge-role";
import { onRequestPatch as AdminEventsEventSlugRegistrationsRegistrationIdBadgeRolePatch_l } from "./badge-role";
import { onRequestGet as AdminEventsEventSlugRegistrationsRegistrationIdGet_l } from "./index";
import { onRequestPatch as AdminEventsEventSlugRegistrationsRegistrationIdPatch_l } from "./index";
import { onRequestPost as AdminEventsEventSlugRegistrationsRegistrationIdOpenManagePost_l } from "./open-manage";
import { onRequestPost as AdminEventsEventSlugRegistrationsRegistrationIdRegenerateBadgePost_l } from "./regenerate-badge";
import { onRequestPost as AdminEventsEventSlugRegistrationsRegistrationIdResendConfirmationPost_l } from "./resend-confirmation";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/admit", AdminEventsEventSlugRegistrationsRegistrationIdAdmitPost_l);
app.get("/audit-log", AdminEventsEventSlugRegistrationsRegistrationIdAuditLogGet_l);
app.get("/badge-role", AdminEventsEventSlugRegistrationsRegistrationIdBadgeRoleGet_l);
app.patch("/badge-role", AdminEventsEventSlugRegistrationsRegistrationIdBadgeRolePatch_l);
app.get("/", AdminEventsEventSlugRegistrationsRegistrationIdGet_l);
app.patch("/", AdminEventsEventSlugRegistrationsRegistrationIdPatch_l);
app.post("/open-manage", AdminEventsEventSlugRegistrationsRegistrationIdOpenManagePost_l);
app.post("/regenerate-badge", AdminEventsEventSlugRegistrationsRegistrationIdRegenerateBadgePost_l);
app.post("/resend-confirmation", AdminEventsEventSlugRegistrationsRegistrationIdResendConfirmationPost_l);

export default app;
