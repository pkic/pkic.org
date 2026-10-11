import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "./_lib/types";

// Keep the application graph out of startup. The module loader initializes it
// once per isolate, on the first event, without retaining any request state.
function loadApplication() {
  return import("./router");
}

/** This entrypoint is reached only after the uncached gateway checks the request. */
export class PublicRead extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const application = await loadApplication();
    return application.handlePublicRead(request, this.env, this.ctx);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const application = await loadApplication();
    return application.default.fetch(request, env, ctx);
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const application = await loadApplication();
    await application.default.email(message, env, ctx);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      loadApplication().then((application) => {
        application.default.scheduled(controller, env, ctx);
      }),
    );
  },
};
