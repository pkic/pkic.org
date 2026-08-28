import { Hono, type Context } from "hono";
import { fromHono } from "chanfana";
import { getCachedAdminForRequest } from "../../../_lib/auth/admin";
import { enforceAdminRouteAuthorization } from "../../../_lib/auth/admin-route-policy";
import { handleError } from "../../../_lib/http";
import type { RequestDbContext } from "../../../_lib/db/context";
import { createRequestScopedD1SessionMiddleware } from "../../../_lib/db/request-session-middleware";
import { AdminEventsCreatePost, AdminEventsListGet } from "./events";
import auth_Router from "./auth/router";
import events_Router from "./events/router";
import forms_Router from "./forms/router";
import proposals_Router from "./proposals/router";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

function normalizedAdminPath(path: string): string {
  if (path.startsWith("/api/v1/admin/")) {
    return path;
  }

  if (path === "/" || path === "") {
    return "/api/v1/admin/";
  }

  return `/api/v1/admin${path.startsWith("/") ? path : `/${path}`}`;
}

function isAdminAuthPath(path: string): boolean {
  return normalizedAdminPath(path).startsWith("/api/v1/admin/auth/");
}

function enforceAdminAuthorization(c: Context<RequestDbContext>): void {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    return;
  }
  enforceAdminRouteAuthorization(admin, normalizedAdminPath(c.req.path), c.req.method);
}

app.use(
  "*",
  createRequestScopedD1SessionMiddleware({
    skipAuthorization: (c) => isAdminAuthPath(c.req.path),
    authorize: enforceAdminAuthorization,
  }),
);

openapi.get("/events", AdminEventsListGet);
openapi.post("/events", AdminEventsCreatePost);
openapi.route("/auth", auth_Router);
openapi.route("/events", events_Router);
openapi.route("/forms", forms_Router);
openapi.route("/proposals", proposals_Router);

export default openapi;
