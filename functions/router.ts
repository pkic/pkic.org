import { Hono } from "hono";
import { fromHono, getReDocUI, getSwaggerUI } from "chanfana";
import { logError, logInfo } from "./_lib/logging";
import { getConfig } from "./_lib/config";
import { runRetentionJob } from "./_lib/services/retention";
import { runScheduledDueWork } from "./_lib/services/scheduled-due-work";
import { runScheduledJobWithD1Budget } from "./_lib/services/scheduled-job-runner";
import {
  runConsultationBatch,
  runEcReviewBatch,
  runEcWindowAutoApprove,
  runGoogleGroupsSyncPass,
  runOnHoldReminders,
} from "./_lib/services/membership/scheduled-jobs";
import { runSponsorshipDueWork } from "./_lib/services/sponsorship-scheduled-jobs";
import { runVotesDueWork } from "./_lib/services/votes-scheduled-jobs";
import { SCHEDULED_CRONS } from "./_lib/scheduled-crons";
import { runWeeklyWgChairDigest } from "./_lib/services/wg-chair-digest";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";
import members_Router from "./members/router";
import events_Router from "./events/router";
import { onRequestGet as OgCardGet } from "./api/v1/og/card/[...path]";
import type { Env } from "./_lib/types";
import { processIncomingEmail } from "./_lib/services/calendar-rsvp-email-ingest";
import { decorateOpenApiSpec, filterOpenApiSpecForMcp } from "./_lib/openapi/mcp";
import { createMcpWorkerFetch, MCP_OPENAPI_JSON_PATH } from "./_lib/mcp/worker";

const OPENAPI_JSON_PATH = "/api/v1/openapi.json";
const DOCS_PATH = "/api/v1/docs";
const REDOC_PATH = "/api/v1/redocs";

const app = new Hono<{ Bindings: Env }>();
export const openapi = fromHono(app, {
  openapi_url: null,
  docs_url: null,
  redoc_url: null,
  schema: {
    info: {
      title: "PKI Consortium API",
      version: "v1",
    },
  },
});

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

let cachedOpenApiSpecBody: string | null = null;

function openApiSpecResponse(): Response {
  if (!cachedOpenApiSpecBody) {
    cachedOpenApiSpecBody = JSON.stringify(decorateOpenApiSpec(openapi.schema));
  }

  return new Response(cachedOpenApiSpecBody, {
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

let cachedMcpOpenApiSpecBody: string | null = null;

function mcpOpenApiSpecResponse(): Response {
  if (!cachedMcpOpenApiSpecBody) {
    cachedMcpOpenApiSpecBody = JSON.stringify(filterOpenApiSpecForMcp(openapi.schema));
  }

  return new Response(cachedMcpOpenApiSpecBody, {
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

app.get("/og/*", OgCardGet);
app.get(OPENAPI_JSON_PATH, openApiSpecResponse);
app.get(MCP_OPENAPI_JSON_PATH, mcpOpenApiSpecResponse);
app.get(DOCS_PATH, () => htmlResponse(getSwaggerUI(OPENAPI_JSON_PATH)));
app.get(REDOC_PATH, () => htmlResponse(getReDocUI(OPENAPI_JSON_PATH)));
openapi.route("/api", api_Router);
openapi.route("/donate", donate_Router);
openapi.route("/r", r_Router);
openapi.route("/members", members_Router);
app.route("/events", events_Router);

// Build the MCP fetch handler after OpenAPI routes are registered.
const fetchWithMcp = createMcpWorkerFetch({ app, openApiSchema: openapi.schema });

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });

  try {
    if (controller.cron === SCHEDULED_CRONS.reminders) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "due_work",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) => runScheduledDueWork(jobEnv, { d1QueryBudget }),
      );
      logInfo("SCHEDULED_REMINDERS_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.onHoldDueWork) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "on_hold_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) =>
          runOnHoldReminders(jobEnv.DB, jobEnv, config.scheduledOnHoldReminderLimit, d1QueryBudget),
      );
      logInfo("SCHEDULED_ON_HOLD_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.ecAutoApprove) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "ec_auto_approve",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) =>
          runEcWindowAutoApprove(jobEnv.DB, jobEnv, config.scheduledEcAutoApproveLimit, d1QueryBudget),
      );
      logInfo("SCHEDULED_EC_AUTO_APPROVE_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.googleGroupsSync) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "google_groups_sync",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) =>
          runGoogleGroupsSyncPass(jobEnv.DB, jobEnv, config.scheduledGoogleGroupsSyncLimit, d1QueryBudget),
      );
      logInfo("SCHEDULED_GOOGLE_GROUPS_SYNC_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.sponsorshipDueWork) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "sponsorship_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) =>
          runSponsorshipDueWork(jobEnv.DB, jobEnv, config.scheduledSponsorshipDueWorkLimit, d1QueryBudget),
      );
      logInfo("SCHEDULED_SPONSORSHIP_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.votesDueWork) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "votes_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv, d1QueryBudget) =>
          runVotesDueWork(
            jobEnv.DB,
            {
              ...jobEnv,
              SCHEDULED_VOTE_NOTIFICATION_LIMIT: String(config.scheduledVoteNotificationLimit),
            },
            config.scheduledVoteDueWorkLimit,
            d1QueryBudget,
          ),
      );
      logInfo("SCHEDULED_VOTES_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.retention) {
      const config = getConfig(env);
      const retention = await runScheduledJobWithD1Budget(env, "retention", config.scheduledD1QueryBudget, (jobEnv) =>
        runRetentionJob(jobEnv.DB),
      );
      logInfo("SCHEDULED_RETENTION_COMPLETED", {
        cron: controller.cron,
        retention,
      });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.consultationBatch) {
      const config = getConfig(env);
      const consultationBatch = await runScheduledJobWithD1Budget(
        env,
        "consultation_batch",
        config.scheduledD1QueryBudget,
        (jobEnv) => runConsultationBatch(jobEnv.DB, jobEnv, config.scheduledConsultationBatchLimit),
      );
      logInfo("SCHEDULED_CONSULTATION_BATCH_COMPLETED", { cron: controller.cron, consultationBatch });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.ecReviewBatch) {
      const config = getConfig(env);
      const ecReviewBatch = await runScheduledJobWithD1Budget(
        env,
        "ec_review_batch",
        config.scheduledD1QueryBudget,
        (jobEnv) => runEcReviewBatch(jobEnv.DB, jobEnv),
      );
      logInfo("SCHEDULED_EC_REVIEW_BATCH_COMPLETED", { cron: controller.cron, ecReviewBatch });
      return;
    }

    if (controller.cron === SCHEDULED_CRONS.workingGroupChairDigest) {
      const config = getConfig(env);
      const wgChairDigest = await runScheduledJobWithD1Budget(
        env,
        "wg_chair_digest",
        config.scheduledD1QueryBudget,
        (jobEnv) => runWeeklyWgChairDigest(jobEnv.DB, jobEnv, new Date(controller.scheduledTime)),
      );
      logInfo("SCHEDULED_WG_CHAIR_DIGEST_COMPLETED", { cron: controller.cron, wgChairDigest });
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await fetchWithMcp(request, env, ctx);
  },
  email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(processIncomingEmail(message, env));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledJob(controller, env));
  },
};
