import { runWithAuditActorScope } from "./_lib/services/audit-actor";
import { AppError } from "./_lib/errors";
import { withDependencyHandling } from "./_lib/dependency-bindings";
import { handleError } from "./_lib/http";
import { availabilityResponse, getAvailability } from "./_lib/availability";
import { logError, logInfo } from "./_lib/logging";
import { getConfig } from "./_lib/config";
import type { Env } from "./_lib/types";
import { primaryFirstDb } from "./_lib/db/session";
import { withRequestD1Session } from "./_lib/db/request-session";
import { WorkerEntrypoint, tracing } from "cloudflare:workers";
import {
  publicSessionRecordingRequest,
  isSessionRecordingPublicPath,
} from "./_lib/services/session-recording-public-release";
import {
  publicSessionPresentationRequest,
  isSessionPresentationPublicPath,
} from "./_lib/services/session-presentation-public-release";
import {
  conditionalPublicReadResponse,
  isPublicReadCacheRequest,
  publicReadCacheResponse,
} from "./_lib/cache/public-read";

import { isLiveRoomSocketPath, liveRoomSocketRequest } from "./_lib/routes/live-session-socket";

/** Durable Object classes this Worker implements; wrangler.jsonc declares them under `exports`. */
export { LiveSessionRoom } from "./_lib/services/live-session/room";

function handleHttpRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Each request owns the scope that tells its audit records which identity the signed-in person acts as.
  return runWithAuditActorScope(async () => {
    const { default: fetchWithMcp } = await tracing.enterSpan("http.router.load", () => import("./http-router"));
    return tracing.enterSpan("http.router.handle", () =>
      withRequestD1Session(request, env, (sessionEnv) =>
        fetchWithMcp(request, withDependencyHandling(sessionEnv), ctx),
      ),
    );
  });
}

/** This entrypoint is reached only after the uncached gateway checks the request. */
export class PublicRead extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (
      isSessionPresentationPublicPath(new URL(request.url).pathname) ||
      isSessionRecordingPublicPath(new URL(request.url).pathname)
    )
      return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
    if (!isPublicReadCacheRequest(request)) {
      return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
    }
    try {
      return await publicReadCacheResponse(await handleHttpRequest(request, this.env, this.ctx), this.env);
    } catch (error) {
      return await publicReadCacheResponse(handleError(error), this.env);
    }
  }
}

async function runScheduledJob(controller: ScheduledController, env: Env): Promise<void> {
  logInfo("SCHEDULED_JOB_STARTED", { cron: controller.cron, scheduledTime: controller.scheduledTime });
  try {
    const [{ dispatchScheduledJobs }, { SCHEDULED_JOB_DEFINITIONS }] = await Promise.all([
      import("./_lib/services/scheduled-jobs/dispatcher"),
      import("./_lib/services/scheduled-jobs/registry"),
    ]);
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
    const presentation = await publicSessionPresentationRequest(request, env);
    if (presentation) return presentation;
    const recording = await publicSessionRecordingRequest(request, env);
    if (recording) return recording;
    const paused = await availabilityResponse(request, env);
    if (paused) return paused;
    if (isLiveRoomSocketPath(request))
      return withRequestD1Session(request, env, (sessionEnv) =>
        liveRoomSocketRequest(request, withDependencyHandling(sessionEnv)),
      );
    try {
      if (isPublicReadCacheRequest(request)) {
        const cacheContext = ctx as ExecutionContext & {
          exports?: { PublicRead: { fetch(request: Request, init: { cf: { cacheKey: string } }): Promise<Response> } };
        };
        if (cacheContext.exports && "PublicRead" in cacheContext.exports) {
          const publicRead = cacheContext.exports.PublicRead;
          const headers = new Headers(request.headers);
          headers.delete("if-none-match");
          headers.delete("if-modified-since");
          // Incoming GET/HEAD requests can carry an empty native body (Content-Length: 0).
          const cacheRequest = new Request(request, { method: "GET", headers, body: null });
          const response = await tracing.enterSpan("http.public_read.cache", () =>
            publicRead.fetch(cacheRequest, { cf: { cacheKey: request.url } }),
          );
          const conditional = conditionalPublicReadResponse(request, response);
          return request.method === "HEAD" && conditional.status === 200
            ? new Response(null, conditional)
            : conditional;
        }
      }
      return await handleHttpRequest(request, env, ctx);
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
    const { processIncomingEmail } = await import("./_lib/services/calendar-rsvp-email-ingest");
    await processIncomingEmail(message, withDependencyHandling({ ...env, DB: primaryFirstDb(env.DB) }));
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    if (getAvailability(env, Date.now(), "background").mode === "normal")
      ctx.waitUntil(runScheduledJob(controller, withDependencyHandling({ ...env, DB: primaryFirstDb(env.DB) })));
  },
};
