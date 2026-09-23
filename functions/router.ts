import { AppError } from "./_lib/errors";
import { withDependencyHandling } from "./_lib/dependency-bindings";
import { handleError } from "./_lib/http";
import { availabilityResponse, getAvailability } from "./_lib/availability";
import { Hono } from "hono";
import { fromHono, getReDocUI, getSwaggerUI } from "chanfana";
import { logError, logInfo } from "./_lib/logging";
import { getConfig } from "./_lib/config";
import { dispatchScheduledJobs } from "./_lib/services/scheduled-jobs/dispatcher";
import { SCHEDULED_JOB_DEFINITIONS } from "./_lib/services/scheduled-jobs/registry";
import api_Router from "./api/router";
import donate_Router from "./donate/router";
import r_Router from "./r/router";
import newsRouter from "./news/router";
import members_Router from "./members/router";
import events_Router from "./events/router";
import { onRequestGet as OgCardGet } from "./og/[...path]";
import type { Env } from "./_lib/types";
import { processIncomingEmail } from "./_lib/services/calendar-rsvp-email-ingest";
import { decorateOpenApiSpec, filterOpenApiSpecForMcp } from "./_lib/openapi/mcp";
import { OPENAPI_INFO, OPENAPI_TAGS, OPENAPI_TAG_GROUPS } from "./_lib/openapi/document";
import { createMcpWorkerFetch, MCP_OPENAPI_JSON_PATH } from "./_lib/mcp/worker";
import { getStaticAssetsBinding } from "./_lib/static-assets";

const OPENAPI_JSON_PATH = "/api/v1/openapi.json";
const DOCS_PATH = "/api/v1/docs";
const REDOC_PATH = "/api/v1/redocs";

const app = new Hono<{ Bindings: Env }>();
app.onError((error) => handleError(error));
export const openapi = fromHono(app, {
  openapi_url: null,
  docs_url: null,
  redoc_url: null,
  schema: {
    info: OPENAPI_INFO,
    tags: [...OPENAPI_TAGS],
    "x-tagGroups": OPENAPI_TAG_GROUPS.map((group) => ({ ...group, tags: [...group.tags] })),
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

async function builtDocumentResponse(
  request: Request,
  env: Env,
  path: string,
  fallback: () => Response,
): Promise<Response> {
  const assets = getStaticAssetsBinding(env);
  if (assets) {
    const response = await assets.fetch(new Request(new URL(path, request.url)));
    if (response.ok) return response;
  }
  return fallback();
}

async function getMcpOpenApiSchema(request: Request, env: Env): Promise<Record<string, unknown>> {
  const assets = getStaticAssetsBinding(env);
  if (assets) {
    const response = await assets.fetch(new Request(new URL(MCP_OPENAPI_JSON_PATH, request.url)));
    if (response.ok) return (await response.json()) as Record<string, unknown>;
  }
  return filterOpenApiSpecForMcp(openapi.schema);
}

app.get("/og/*", OgCardGet);
app.get(OPENAPI_JSON_PATH, (c) => builtDocumentResponse(c.req.raw, c.env, OPENAPI_JSON_PATH, openApiSpecResponse));
app.get(MCP_OPENAPI_JSON_PATH, (c) =>
  builtDocumentResponse(c.req.raw, c.env, MCP_OPENAPI_JSON_PATH, mcpOpenApiSpecResponse),
);
app.get(DOCS_PATH, () => htmlResponse(getSwaggerUI(OPENAPI_JSON_PATH)));
app.get(REDOC_PATH, () => htmlResponse(getReDocUI(OPENAPI_JSON_PATH)));
openapi.route("/api", api_Router);
openapi.route("/donate", donate_Router);
openapi.route("/r", r_Router);
openapi.route("/members", members_Router);
app.route("/news", newsRouter);
app.route("/events", events_Router);

// Build the MCP fetch handler after OpenAPI routes are registered.
const fetchWithMcp = createMcpWorkerFetch({ app, getMcpOpenApiSchema });

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });
  try {
    const config = getConfig(env);
    const outcome = await dispatchScheduledJobs(env, SCHEDULED_JOB_DEFINITIONS, {
      maxJobsPerPass: config.scheduledJobsPerPass,
      d1QueryBudget: config.scheduledD1QueryBudget,
    });
    logInfo("SCHEDULED_DISPATCH_COMPLETED", { cron: controller.cron, ...outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduled job failure";
    logError("SCHEDULED_JOB_FAILED", {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
      error: message,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const paused = await availabilityResponse(request, env);
    if (paused) return paused;
    try {
      return await fetchWithMcp(request, withDependencyHandling(env), ctx);
    } catch (error) {
      return handleError(error);
    }
  },
  async email(message: ForwardableEmailMessage, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (getAvailability(env, Date.now(), "email").mode !== "normal") {
      // Email Routing maps an exception to temporary SMTP 421; setReject is permanent.
      // Verified with live SMTP and recovery in issue #81. Retry ownership stays with the sender.
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Online RSVP processing is temporarily paused");
    }
    // Inbound acceptance must wait for processing; waitUntil could acknowledge mail before D1 succeeds.
    await processIncomingEmail(message, withDependencyHandling(env));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (getAvailability(env, Date.now(), "background").mode === "normal")
      ctx.waitUntil(runScheduledJob(controller, withDependencyHandling(env)));
  },
};
