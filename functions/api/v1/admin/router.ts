import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import {
  getCachedAdminAuthTransport,
  getCachedAdminForRequest,
  requireAdminFromRequest,
  serializeAdminSessionCookie,
  signAdminSessionToken,
} from "../../../_lib/auth/admin";
import { handleError } from "../../../_lib/http";
import { requireAuthScope } from "../../../_lib/auth/scopes";
import { REQUEST_DB_CONTEXT_KEY, type RequestDbContext } from "../../../_lib/db/context";
import { primaryFirstDb, readReplicaDb } from "../../../_lib/db/session";
import type { DatabaseSessionLike } from "../../../_lib/db/session";
import { inferredScopesForOperation } from "../../../_lib/openapi/mcp";
import { AdminAuditLogList } from "./audit-log";
import { onRequestGet as AdminDonationsGet_l } from "./donations";
import { onRequestGet as AdminEmailTemplatesGet_l } from "./email-templates";
import { onRequestGet as AdminEventsGet_l } from "./events";
import { onRequestPost as AdminEventsPost_l } from "./events";
import { onRequestGet as AdminStatsGet_l } from "./stats";
import { onRequestGet as AdminUsersGet_l } from "./users";
import access_grants_Router from "./access-grants/router";
import auth_Router from "./auth/router";
import donations_Router from "./donations/router";
import email_Router from "./email/router";
import email_templates_Router from "./email-templates/router";
import events_Router from "./events/router";
import forms_Router from "./forms/router";
import leadership_positions_Router from "./leadership-positions/router";
import mailing_lists_Router from "./mailing-lists/router";
import members_Router from "./members/router";
import membership_settings_Router from "./membership-settings/router";
import applications_Router from "./applications/router";
import consortium_Router from "./consortium/router";
import organizations_Router from "./organizations/router";
import proposals_Router from "./proposals/router";
import roles_Router from "./roles/router";
import sponsorships_Router from "./sponsorships/router";
import users_Router from "./users/router";
import votes_Router from "./votes/router";
import vote_proposals_Router from "./vote-proposals/router";
import working_groups_Router from "./working-groups/router";

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

/**
 * Admin surfaces still governed by the legacy global AUTH_SCOPES system
 * (_lib/auth/scopes.ts) rather than the context-aware permission system
 * (_lib/auth/permissions.ts) — a small, closed set of the original admin
 * routes that predate the permission system and have not been migrated
 * onto it. Every other admin surface enforces its own requirePermission
 * check (with resource-context resolution where the resource has an
 * owner, e.g. requireEventManagementAccess in events/[eventSlug]/router.ts,
 * requireWorkingGroupAccess in working-groups/[id]/router.ts,
 * requireProposalAccess in proposals/[proposalId]/router.ts) directly in
 * its own router/handler, so admin/router.ts does not need — and must not
 * assume — a matching list of "which paths were migrated" to stay correct.
 *
 * This replaces the old isPermissionGatedAdminPath, which inverted the
 * same distinction as an ever-growing allowlist of *migrated* paths that
 * every new permission-gated feature had to remember to add itself to —
 * exactly the "assumes every current and future descendant handler
 * remembers its own permission check" fail-open composition flagged in
 * PR #1 review (round 2, item 4.1). That list had already drifted out of
 * sync with reality before this rewrite: leadership-positions had its own
 * requirePermission("access:grant"/"access:revoke") checks but was
 * missing from the list, so a non-admin-role actor holding an access:grant
 * grant was incorrectly 403'd by the legacy scope check before ever
 * reaching that handler's own, more permissive check.
 */
const LEGACY_SCOPE_PATH_PREFIXES = [
  "/api/v1/admin/donations",
  "/api/v1/admin/audit-log",
  "/api/v1/admin/email-templates",
  "/api/v1/admin/stats",
  "/api/v1/admin/email",
  "/api/v1/admin/forms",
  "/api/v1/admin/mailing-lists",
];

// /admin/users/:userId/(roles|membership|emails|merge) are permission-gated
// (access:grant/access:revoke, membership:write, users:write); the rest of
// /admin/users (list, single-user get/patch, anonymize, gravatar, headshot)
// is still legacy-scope-only.
const PERMISSION_GATED_USER_SUBPATH = /^\/api\/v1\/admin\/users\/[^/]+\/(roles|membership|emails|merge)/;

function requiresLegacyScopeCheck(path: string): boolean {
  if (PERMISSION_GATED_USER_SUBPATH.test(path)) {
    return false;
  }
  if (path.startsWith("/api/v1/admin/users")) {
    return true;
  }
  return LEGACY_SCOPE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function enforceAdminScopes(c: Context<RequestDbContext>): void {
  const admin = getCachedAdminForRequest(c.req.raw);
  if (!admin) {
    return;
  }

  const path = normalizedAdminPath(c.req.path);
  if (!requiresLegacyScopeCheck(path)) {
    return;
  }

  for (const scope of inferredScopesForOperation(path, c.req.method.toLowerCase())) {
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
      enforceAdminScopes(c);
    }
    await next();
    await rotateAdminToken(c, sessionDb).catch((err) => {
      console.error("[rotateAdminToken] Failed to rotate token:", err);
    });
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
app.get("/email-templates", AdminEmailTemplatesGet_l);
app.get("/events", AdminEventsGet_l);
app.post("/events", AdminEventsPost_l);
app.get("/stats", AdminStatsGet_l);
app.get("/users", AdminUsersGet_l);
openapi.get("/audit-log", AdminAuditLogList);
openapi.route("/access-grants", access_grants_Router);
openapi.route("/auth", auth_Router);
openapi.route("/donations", donations_Router);
openapi.route("/email", email_Router);
openapi.route("/email-templates", email_templates_Router);
openapi.route("/events", events_Router);
openapi.route("/forms", forms_Router);
openapi.route("/leadership-positions", leadership_positions_Router);
openapi.route("/mailing-lists", mailing_lists_Router);
openapi.route("/members", members_Router);
openapi.route("/membership-settings", membership_settings_Router);
openapi.route("/applications", applications_Router);
openapi.route("/consortium", consortium_Router);
openapi.route("/organizations", organizations_Router);
openapi.route("/proposals", proposals_Router);
openapi.route("/roles", roles_Router);
openapi.route("/sponsorships", sponsorships_Router);
openapi.route("/users", users_Router);
openapi.route("/votes", votes_Router);
openapi.route("/vote-proposals", vote_proposals_Router);
openapi.route("/working-groups", working_groups_Router);

export default openapi;
