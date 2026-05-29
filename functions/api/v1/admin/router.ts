import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import {
  getCachedAdminAuthTransport,
  getCachedAdminForRequest,
  requireAdminFromRequest,
  serializeAdminSessionCookie,
  signAdminSessionToken,
} from "../../../_lib/auth/admin";
import { requireAuthScope } from "../../../_lib/auth/scopes";
import { REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "../../../_lib/db/context";
import { primaryFirstDb, readReplicaDb } from "../../../_lib/db/session";
import type { DatabaseSessionLike } from "../../../_lib/db/session";
import { inferredScopesForOperation } from "../../../_lib/openapi/mcp";
import { onRequestGet as AdminAuditLogGet_l } from "./audit-log";
import { onRequestGet as AdminDonationsGet_l } from "./donations";
import { onRequestGet as AdminEmailTemplatesGet_l } from "./email-templates";
import { onRequestGet as AdminEventsGet_l } from "./events";
import { onRequestPost as AdminEventsPost_l } from "./events";
import { onRequestGet as AdminStatsGet_l } from "./stats";
import { onRequestGet as AdminUsersGet_l } from "./users";
import auth_Router from "./auth/router";
import donations_Router from "./donations/router";
import email_Router from "./email/router";
import email_templates_Router from "./email-templates/router";
import events_Router from "./events/router";
import forms_Router from "./forms/router";
import proposals_Router from "./proposals/router";
import users_Router from "./users/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);
const ADMIN_TOKEN_HEADER = "x-admin-token";

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

function enforceAdminScopes(c: Context<RequestDbContext>): void {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    return;
  }

  for (const scope of inferredScopesForOperation(normalizedAdminPath(c.req.path), c.req.method.toLowerCase())) {
    requireAuthScope(admin, scope);
  }
}

async function rotateAdminToken(c: Context<RequestDbContext>, sessionDb: DatabaseSessionLike): Promise<void> {
  const state = sessionDb.getBookmark?.();
  const admin = getCachedAdminForRequest(c.req.raw);
  const transport = getCachedAdminAuthTransport(c.req.raw);
  if (!state || !admin?.sessionId || !admin.expiresAt || !c.env.INTERNAL_SIGNING_SECRET || transport === "api-key") {
    return;
  }

  const token = await signAdminSessionToken(c.env.INTERNAL_SIGNING_SECRET, {
    admin,
    sessionId: admin.sessionId,
    expiresAt: admin.expiresAt,
    state,
  });

  if (transport === "cookie") {
    c.res.headers.append("Set-Cookie", serializeAdminSessionCookie(token, c.req.raw));
    return;
  }

  c.header(ADMIN_TOKEN_HEADER, token);
}

async function useRequestScopedD1Session(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const method = c.req.method;
  const primaryDb = c.env.DB;

  if (method !== "GET" && method !== "HEAD") {
    const sessionDb = primaryFirstDb(primaryDb);
    c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
    if (!isAdminAuthPath(c.req.path)) {
      await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
      enforceAdminScopes(c);
    }
    await next();
    await rotateAdminToken(c, sessionDb);
    return;
  }

  const admin = await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
  if (!isAdminAuthPath(c.req.path)) {
    enforceAdminScopes(c);
  }
  // Validate state bookmark: must be a reasonable string (null is ok for default session)
  const bookmark = admin.state ? (admin.state.length > 0 && admin.state.length < 1024 ? admin.state : null) : null;
  const sessionDb = readReplicaDb(primaryDb, bookmark);
  c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
  await next();
  await rotateAdminToken(c, sessionDb);
}

app.use("*", useRequestScopedD1Session);

app.get("/donations", AdminDonationsGet_l);
app.get("/audit-log", AdminAuditLogGet_l);
app.get("/email-templates", AdminEmailTemplatesGet_l);
app.get("/events", AdminEventsGet_l);
app.post("/events", AdminEventsPost_l);
app.get("/stats", AdminStatsGet_l);
app.get("/users", AdminUsersGet_l);
openapi.route("/auth", auth_Router);
openapi.route("/donations", donations_Router);
openapi.route("/email", email_Router);
openapi.route("/email-templates", email_templates_Router);
openapi.route("/events", events_Router);
openapi.route("/forms", forms_Router);
openapi.route("/proposals", proposals_Router);
openapi.route("/users", users_Router);

export default openapi;
