import { Hono } from "hono";
import { fromHono } from "chanfana";
import calendar_Router from "./calendar/router";
import email_Router from "./email/router";
import jobs_Router from "./jobs/router";
import reminders_Router from "./reminders/router";
import retention_Router from "./retention/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/calendar", calendar_Router);
openapi.route("/email", email_Router);
openapi.route("/jobs", jobs_Router);
openapi.route("/reminders", reminders_Router);
openapi.route("/retention", retention_Router);

export default openapi;
