import { Hono } from "hono";
import { fromHono, getReDocUI, getSwaggerUI } from "chanfana";
import { DynamicWorkerExecutor, type Executor, type ExecuteResult } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import { createMcpHandler } from "agents/mcp";
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

const OPENAPI_JSON_PATH = "/api/v1/openapi.json";
const MCP_PATH = "/api/v1/mcp";
const MCP_OPENAPI_JSON_PATH = "/api/v1/mcp/openapi.json";
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

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    headers: { "content-type": "text/html; charset=UTF-8" },
  });
}

function openApiSpecResponse(): Response {
  return jsonResponse(decorateOpenApiSpec(openapi.schema));
}

function mcpOpenApiSpecResponse(): Response {
  return jsonResponse(filterOpenApiSpecForMcp(openapi.schema));
}

class MissingWorkerLoaderExecutor implements Executor {
  async execute(): Promise<ExecuteResult> {
    return {
      result: null,
      error: "MCP code execution is unavailable because the LOADER binding is not configured.",
    };
  }
}

function mcpExecutor(env: Env): Executor {
  return env.LOADER ? new DynamicWorkerExecutor({ loader: env.LOADER }) : new MissingWorkerLoaderExecutor();
}

function apiRequestFromMcp(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): (options: RequestOptions) => Promise<unknown> {
  const authorization = request.headers.get("authorization");

  return async ({ method, path, query, body, contentType, rawBody }) => {
    const url = new URL(path, request.url);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers({ accept: "application/json" });
    if (authorization) {
      headers.set("authorization", authorization);
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined && method !== "GET") {
      requestBody = rawBody && typeof body === "string" ? body : JSON.stringify(body);
      headers.set("content-type", contentType ?? "application/json");
    }

    const response = await app.fetch(new Request(url, { method, headers, body: requestBody }), env, ctx);
    const responseType = response.headers.get("content-type") ?? "";
    if (responseType.includes("application/json")) {
      return response.json();
    }

    return {
      status: response.status,
      body: await response.text(),
    };
  };
}

function mcpResponse(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const server = openApiMcpServer({
    spec: filterOpenApiSpecForMcp(openapi.schema),
    executor: mcpExecutor(env),
    request: apiRequestFromMcp(request, env, ctx),
    name: "pkic-api",
    version: "v1",
    description: "Search and call PKI Consortium API operations exposed for MCP.",
  });

  return createMcpHandler(server, { route: MCP_PATH })(request, env, ctx);
}

const REMINDER_CRON = "*/15 * * * *";
const RETENTION_CRON = "0 3 * * *";

app.get("/og/*", OgCardGet);
app.get(OPENAPI_JSON_PATH, openApiSpecResponse);
app.all(MCP_PATH, (c) => mcpResponse(c.req.raw, c.env, c.executionCtx));
app.get(MCP_OPENAPI_JSON_PATH, mcpOpenApiSpecResponse);
app.get(DOCS_PATH, () => htmlResponse(getSwaggerUI(OPENAPI_JSON_PATH)));
app.get(REDOC_PATH, () => htmlResponse(getReDocUI(OPENAPI_JSON_PATH)));
openapi.route("/api", api_Router);
openapi.route("/donate", donate_Router);
openapi.route("/r", r_Router);

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
  fetch: app.fetch,
  email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(processIncomingEmail(message, env));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runScheduledJob(controller, env));
  },
};
