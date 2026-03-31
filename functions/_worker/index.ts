import { Hono } from "hono";
import type { Env as AppEnv, PagesContext } from "../_lib/types";
import { generatedRoutes } from "./generated-routes";
import type { RouteHandler, RouteModule } from "./types";
import * as apiV1Middleware from "../api/v1/_middleware";
import * as redirectsMiddleware from "../r/_middleware";
import * as donateRedirectsMiddleware from "../donate/r/_middleware";

interface StaticAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

type WorkerBindings = AppEnv & {
  ASSETS?: StaticAssetsBinding;
};

const app = new Hono<{ Bindings: WorkerBindings }>();

function methodHandlerFor(module: RouteModule, method: string): RouteHandler | undefined {
  if (method === "GET") return module.onRequestGet;
  if (method === "POST") return module.onRequestPost;
  if (method === "PUT") return module.onRequestPut;
  if (method === "PATCH") return module.onRequestPatch;
  if (method === "DELETE") return module.onRequestDelete;
  if (method === "HEAD") return module.onRequestHead;
  if (method === "OPTIONS") return module.onRequestOptions;
  return undefined;
}

function middlewareForPath(pathname: string): Array<(ctx: PagesContext) => Promise<Response>> {
  const middleware: Array<(ctx: PagesContext) => Promise<Response>> = [];

  if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
    middleware.push(apiV1Middleware.onRequest);
  }
  if (pathname === "/donate/r" || pathname.startsWith("/donate/r/")) {
    middleware.push(donateRedirectsMiddleware.onRequest);
  }
  if (pathname === "/r" || pathname.startsWith("/r/")) {
    middleware.push(redirectsMiddleware.onRequest);
  }

  return middleware;
}

async function executeRoute(
  module: RouteModule,
  context: PagesContext,
): Promise<Response> {
  const method = context.request.method.toUpperCase();
  const methodHandler = methodHandlerFor(module, method);
  if (methodHandler) {
    return methodHandler(context);
  }
  if (module.onRequest) {
    return module.onRequest(context);
  }

  return new Response("Method not allowed", { status: 405 });
}

for (const route of generatedRoutes) {
  app.all(route.path, async (c) => {
    const request = c.req.raw;
    const pathname = new URL(request.url).pathname;
    const middleware = middlewareForPath(pathname);

    const context: PagesContext<Record<string, string>> = {
      request,
      env: c.env,
      params: c.req.param(),
      waitUntil(promise) {
        c.executionCtx.waitUntil(promise);
      },
    };

    const run = async (index: number): Promise<Response> => {
      if (index >= middleware.length) {
        return executeRoute(route.module, context);
      }
      context.next = () => run(index + 1);
      return middleware[index](context);
    };

    return run(0);
  });
}

app.notFound(async (c) => {
  const staticAssets = c.env.ASSETS;
  if (staticAssets) {
    return staticAssets.fetch(c.req.raw);
  }
  return c.text("Not found", 404);
});

export default {
  fetch: app.fetch,
};
