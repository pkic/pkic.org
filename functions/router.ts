import { Hono } from "hono";
import { fromHono } from "chanfana";
import { getConfig } from "./_lib/config";
import { processPendingOutbox } from "./_lib/email/outbox";
import { logError, logInfo } from "./_lib/logging";
import { runReminderCycle } from "./_lib/services/reminders";
import { runRetentionJob } from "./_lib/services/retention";
import { runRsvpEnforcer } from "./_lib/services/rsvp-enforcer";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";
import { onRequestGet as OgCardGet } from "./api/v1/og/card/[...path]";
import type { Env } from "./_lib/types";
import { processIncomingEmail } from "./_lib/email/ingest";

const app = new Hono<{ Bindings: Env }>();
export const openapi = fromHono(app);

const REMINDER_CRON = "*/15 * * * *";
const RETENTION_CRON = "0 3 * * *";

app.get("/og/*", OgCardGet);
app.route("/api", api_Router);
app.route("/donate", donate_Router);
app.route("/r", r_Router);

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });

  try {
    if (controller.cron === REMINDER_CRON) {
      const config = getConfig(env);
      const reminders = await runReminderCycle(env.DB, {
        appBaseUrl: config.appBaseUrl,
        reminderIntervalDays: config.reminderIntervalDays,
        maxInviteReminders: config.maxInviteReminders,
        maxPresentationReminders: config.maxPresentationReminders,
        limit: config.scheduledReminderLimit,
      });
      const outbox = await processPendingOutbox(env.DB, env, config.scheduledOutboxLimit);

      const rsvpEnforcement = await runRsvpEnforcer(env.DB, env);

      logInfo("SCHEDULED_REMINDERS_COMPLETED", {
        cron: controller.cron,
        reminders,
        outbox,
        rsvpEnforcement,
      });
      return;
    }

    if (controller.cron === RETENTION_CRON) {
      const retention = await runRetentionJob(env.DB);
      logInfo("SCHEDULED_RETENTION_COMPLETED", {
        cron: controller.cron,
        retention,
      });
      return;
    }

    logInfo("SCHEDULED_JOB_SKIPPED", { cron: controller.cron });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled job failure";
    logError("SCHEDULED_JOB_FAILED", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      error: message,
    });
    throw error;
  }
}

export default {
  fetch: app.fetch,
  email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(processIncomingEmail(message, env));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledJob(controller, env));
  },
};
