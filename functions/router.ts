import { Hono } from "hono";
import { fromHono, getReDocUI, getSwaggerUI } from "chanfana";
import { logError, logInfo } from "./_lib/logging";
import { runRetentionJob } from "./_lib/services/retention";
import { runScheduledDueWork } from "./_lib/services/scheduled-due-work";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";
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
const RETENTION_CRON = "0 3 * * *";

app.get("/og/*", OgCardGet);
app.get(OPENAPI_JSON_PATH, openApiSpecResponse);
app.get(MCP_OPENAPI_JSON_PATH, mcpOpenApiSpecResponse);
app.get(DOCS_PATH, () => htmlResponse(getSwaggerUI(OPENAPI_JSON_PATH)));
app.get(REDOC_PATH, () => htmlResponse(getReDocUI(OPENAPI_JSON_PATH)));
openapi.route("/api", api_Router);
openapi.route("/donate", donate_Router);
openapi.route("/r", r_Router);

// Build the MCP fetch handler after OpenAPI routes are registered.
const fetchWithMcp = createMcpWorkerFetch({ app, openApiSchema: openapi.schema });

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });

  try {
    if (controller.cron === REMINDER_CRON) {
      const dueWork = await runScheduledDueWork(env);

      logInfo("SCHEDULED_REMINDERS_COMPLETED", {
        cron: controller.cron,
        dueWork,
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
