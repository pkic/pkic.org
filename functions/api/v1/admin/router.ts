import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminAuditLogGet_l } from "./audit-log";
import { onRequestGet as AdminDonationsGet_l } from "./donations";
import { onRequestGet as AdminEmailTemplatesGet_l } from "./email-templates";
import { onRequestGet as AdminEventsGet_l } from "./events";
import { onRequestPost as AdminEventsPost_l } from "./events";
import { onRequestGet as AdminStatsGet_l } from "./stats";
import { onRequestGet as AdminUsersGet_l } from "./users";
import auth_Router from "./auth/router";
import donations_Router from "./donations/router";
import email_Router from "./email/router";
import email_templates_Router from "./email-templates/router";
import events_Router from "./events/router";
import forms_Router from "./forms/router";
import proposals_Router from "./proposals/router";
import users_Router from "./users/router";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/donations", AdminDonationsGet_l);
app.get("/audit-log", AdminAuditLogGet_l);
app.get("/email-templates", AdminEmailTemplatesGet_l);
app.get("/events", AdminEventsGet_l);
app.post("/events", AdminEventsPost_l);
app.get("/stats", AdminStatsGet_l);
app.get("/users", AdminUsersGet_l);
app.route("/auth", auth_Router);
app.route("/donations", donations_Router);
app.route("/email", email_Router);
app.route("/email-templates", email_templates_Router);
app.route("/events", events_Router);
app.route("/forms", forms_Router);
app.route("/proposals", proposals_Router);
app.route("/users", users_Router);

export default app;
