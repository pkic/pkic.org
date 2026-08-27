import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import {
  getCachedAdminAuthTransport,
  getCachedAdminForRequest,
  requireAdminFromRequest,
  serializeAdminSessionCookie,
  signAdminSessionToken,
} from "../../../_lib/auth/admin";
import { isUserBackedAuthAdmin } from "../../../_lib/auth/admin-identity";
import { enforceAdminRouteAuthorization } from "../../../_lib/auth/admin-route-policy";
import { handleError } from "../../../_lib/http";
import { REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "../../../_lib/db/context";
import { primaryFirstDb, readReplicaDb } from "../../../_lib/db/session";
import type { DatabaseSessionLike } from "../../../_lib/db/session";
import { AdminAuditLogList } from "./audit-log";
import { AdminDueWorkList } from "./due-work";
import { EmailTemplatesList } from "./email-templates";
import { AdminEventsCreatePost, AdminEventsListGet } from "./events";
import { AdminStatsGet } from "./stats";
import { UsersList } from "./users";
import access_grants_Router from "./access-grants/router";
import auth_Router from "./auth/router";
import donations_Router from "./donations/router";
import email_Router from "./email/router";
import email_templates_Router from "./email-templates/router";
import events_Router from "./events/router";
import forms_Router from "./forms/router";
import leadership_positions_Router from "./leadership-positions/router";
import members_Router from "./members/router";
import membership_settings_Router from "./membership-settings/router";
import applications_Router from "./applications/router";
import organizations_Router from "./organizations/router";
import proposals_Router from "./proposals/router";
import roles_Router from "./roles/router";
import sponsorships_Router from "./sponsorships/router";
import users_Router from "./users/router";
import votes_Router from "./votes/router";
import vote_proposals_Router from "./vote-proposals/router";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
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

function enforceAdminAuthorization(c: Context<RequestDbContext>): void {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    return;
  }
  enforceAdminRouteAuthorization(admin, normalizedAdminPath(c.req.path), c.req.method);
}

async function rotateAdminToken(c: Context<RequestDbContext>, sessionDb: DatabaseSessionLike): Promise<void> {
  const state = sessionDb.getBookmark?.();
  const admin = getCachedAdminForRequest(c.req.raw);
  const transport = getCachedAdminAuthTransport(c.req.raw);
  if (
    !state ||
    !admin ||
    !isUserBackedAuthAdmin(admin) ||
    !admin.sessionId ||
    !admin.expiresAt ||
    !c.env.INTERNAL_SIGNING_SECRET ||
    transport === "api-key"
  ) {
    return;
  }

  const token = await signAdminSessionToken(c.env.INTERNAL_SIGNING_SECRET, {
    admin,
    sessionId: admin.sessionId,
    expiresAt: admin.expiresAt,
    state,
  });

  // Build a fresh mutable Headers object from the existing response so we can
  // append without hitting the immutable-headers guard in the Workers runtime.
  const headers = new Headers(c.res.headers);

  if (transport === "cookie") {
    headers.append("Set-Cookie", serializeAdminSessionCookie(token, c.req.raw));
  } else {
    headers.set(ADMIN_TOKEN_HEADER, token);
  }

  c.res = new Response(c.res.body, { status: c.res.status, headers });
}

async function useRequestScopedD1Session(c: Context<RequestDbContext>, next: Next): Promise<void> {
  const method = c.req.method;
  const primaryDb = c.env.DB;

  if (method !== "GET" && method !== "HEAD") {
    const sessionDb = primaryFirstDb(primaryDb);
    c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
    if (!isAdminAuthPath(c.req.path)) {
      await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
      enforceAdminAuthorization(c);
    }
    await next();
    await rotateAdminToken(c, sessionDb).catch((err) => {
      console.error("[rotateAdminToken] Failed to rotate token:", err);
    });
    return;
  }

  const admin = await requireAdminFromRequest(primaryDb, c.req.raw, c.env);
  if (!isAdminAuthPath(c.req.path)) {
    enforceAdminAuthorization(c);
  }
  // Validate state bookmark: must be a reasonable string (null is ok for default session)
  const state = isUserBackedAuthAdmin(admin) ? admin.state : null;
  const bookmark = state ? (state.length > 0 && state.length < 1024 ? state : null) : null;
  const sessionDb = readReplicaDb(primaryDb, bookmark);
  c.set(REQUEST_DB_CONTEXT_KEY, sessionDb);
  await next();
  await rotateAdminToken(c, sessionDb);
}

app.use("*", useRequestScopedD1Session);

openapi.get("/email-templates", EmailTemplatesList);
openapi.get("/events", AdminEventsListGet);
openapi.post("/events", AdminEventsCreatePost);
openapi.get("/stats", AdminStatsGet);
openapi.get("/audit-log", AdminAuditLogList);
openapi.get("/due-work", AdminDueWorkList);
openapi.get("/users", UsersList);
openapi.route("/access-grants", access_grants_Router);
openapi.route("/auth", auth_Router);
openapi.route("/donations", donations_Router);
openapi.route("/email", email_Router);
openapi.route("/email-templates", email_templates_Router);
openapi.route("/events", events_Router);
openapi.route("/forms", forms_Router);
openapi.route("/leadership-positions", leadership_positions_Router);
openapi.route("/members", members_Router);
openapi.route("/membership-settings", membership_settings_Router);
openapi.route("/applications", applications_Router);
openapi.route("/organizations", organizations_Router);
openapi.route("/proposals", proposals_Router);
openapi.route("/roles", roles_Router);
openapi.route("/sponsorships", sponsorships_Router);
openapi.route("/users", users_Router);
openapi.route("/votes", votes_Router);
openapi.route("/vote-proposals", vote_proposals_Router);

export default openapi;
