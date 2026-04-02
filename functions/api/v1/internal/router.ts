import { Hono } from "hono";
import { fromHono } from "chanfana";
import calendar_Router from "./calendar/router";
import email_Router from "./email/router";
import jobs_Router from "./jobs/router";
import reminders_Router from "./reminders/router";
import retention_Router from "./retention/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/calendar", calendar_Router);
app.route("/email", email_Router);
app.route("/jobs", jobs_Router);
app.route("/reminders", reminders_Router);
app.route("/retention", retention_Router);

export default app;
