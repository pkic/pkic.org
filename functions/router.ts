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
  runMembershipDueWork,
} from "./_lib/services/membership/scheduled-jobs";
import { runSponsorshipDueWork } from "./_lib/services/sponsorship-scheduled-jobs";
import { runVotesDueWork } from "./_lib/services/votes-scheduled-jobs";
import { runWeeklyWgChairDigest } from "./_lib/services/wg-chair-digest";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";
import members_Router from "./members/router";
import { onRequestGet as OgCardGet } from "./api/v1/og/card/[...path]";
import type { Env } from "./_lib/types";
import { processIncomingEmail } from "./_lib/email/ingest";
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

const REMINDER_CRON = "*/15 * * * *";
const MEMBERSHIP_DUE_WORK_CRON = "2,17,32,47 * * * *";
const SPONSORSHIP_DUE_WORK_CRON = "5,20,35,50 * * * *";
const VOTES_DUE_WORK_CRON = "8,23,38,53 * * * *";
const RETENTION_CRON = "0 3 * * *";
// defaults: consultation batch Mon/Wed 07:15 UTC, EC review batch Mon/Wed 08:15 UTC.
const CONSULTATION_BATCH_CRON = "15 7 * * 1,3";
const EC_REVIEW_BATCH_CRON = "15 8 * * 1,3";
// Weekly WG chair membership-change digest (2026-07-31 manual-testing
// feedback) — Monday 08:00 UTC, ahead of the EC review batch's 08:15 slot.
const WG_CHAIR_DIGEST_CRON = "0 8 * * 1";

app.get("/og/*", OgCardGet);
app.get(OPENAPI_JSON_PATH, openApiSpecResponse);
app.get(MCP_OPENAPI_JSON_PATH, mcpOpenApiSpecResponse);
app.get(DOCS_PATH, () => htmlResponse(getSwaggerUI(OPENAPI_JSON_PATH)));
app.get(REDOC_PATH, () => htmlResponse(getReDocUI(OPENAPI_JSON_PATH)));
openapi.route("/api", api_Router);
openapi.route("/donate", donate_Router);
openapi.route("/r", r_Router);
openapi.route("/members", members_Router);

// Build the MCP fetch handler after OpenAPI routes are registered.
const fetchWithMcp = createMcpWorkerFetch({ app, openApiSchema: openapi.schema });

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });

  try {
    if (controller.cron === REMINDER_CRON) {
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

    if (controller.cron === MEMBERSHIP_DUE_WORK_CRON) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "membership_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv) =>
          runMembershipDueWork(jobEnv.DB, jobEnv, {
            onHoldReminderLimit: config.scheduledOnHoldReminderLimit,
            ecAutoApproveLimit: config.scheduledEcAutoApproveLimit,
          }),
      );
      logInfo("SCHEDULED_MEMBERSHIP_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === SPONSORSHIP_DUE_WORK_CRON) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "sponsorship_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv) => runSponsorshipDueWork(jobEnv.DB, jobEnv, config.scheduledSponsorshipDueWorkLimit),
      );
      logInfo("SCHEDULED_SPONSORSHIP_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === VOTES_DUE_WORK_CRON) {
      const config = getConfig(env);
      const outcome = await runScheduledJobWithD1Budget(
        env,
        "votes_due_work",
        config.scheduledD1QueryBudget,
        (jobEnv) =>
          runVotesDueWork(jobEnv.DB, {
            ...jobEnv,
            SCHEDULED_VOTE_NOTIFICATION_LIMIT: String(config.scheduledVoteNotificationLimit),
          }),
      );
      logInfo("SCHEDULED_VOTES_DUE_WORK_COMPLETED", { cron: controller.cron, outcome });
      return;
    }

    if (controller.cron === RETENTION_CRON) {
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

    if (controller.cron === CONSULTATION_BATCH_CRON) {
      const config = getConfig(env);
      const consultationBatch = await runScheduledJobWithD1Budget(
        env,
        "consultation_batch",
        config.scheduledD1QueryBudget,
        (jobEnv) => runConsultationBatch(jobEnv.DB, jobEnv),
      );
      logInfo("SCHEDULED_CONSULTATION_BATCH_COMPLETED", { cron: controller.cron, consultationBatch });
      return;
    }

    if (controller.cron === EC_REVIEW_BATCH_CRON) {
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

    if (controller.cron === WG_CHAIR_DIGEST_CRON) {
      const config = getConfig(env);
      const wgChairDigest = await runScheduledJobWithD1Budget(
        env,
        "wg_chair_digest",
        config.scheduledD1QueryBudget,
        (jobEnv) => runWeeklyWgChairDigest(jobEnv.DB, jobEnv),
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
