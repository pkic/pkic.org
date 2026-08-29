import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EmailTemplatesList } from "./templates";
import emailTemplates_Router from "./templates/router";
import { EmailReminderRunCreate } from "./reminders/runs/index";
import { EmailOutboxGet } from "./outbox";
import { EmailOutboxProcessPost } from "./outbox/process";
import { EmailOutboxResetFailedPost } from "./outbox/reset-failed";
import { EmailSendgridWebhookPost } from "./sendgrid/webhook";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/templates", EmailTemplatesList);
openapi.route("/templates", emailTemplates_Router);
openapi.post("/sendgrid/webhook", EmailSendgridWebhookPost);
openapi.get("/outbox", EmailOutboxGet);
openapi.post("/outbox/process", EmailOutboxProcessPost);
openapi.post("/outbox/reset-failed", EmailOutboxResetFailedPost);
openapi.post("/reminders/runs", EmailReminderRunCreate);

export default openapi;
