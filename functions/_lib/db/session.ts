import type { DatabaseLike } from "../types";
import { hasAuthenticationCredential } from "../auth/session-cookies";

type D1SessionConstraint = "first-primary" | "first-unconstrained";

export type DatabaseSessionLike = DatabaseLike & {
  getBookmark?(): string | null;
};

const READ_METHODS = new Set(["GET", "HEAD"]);
const PRIMARY_READ_PATH_PREFIXES = [
  "/api/v1/auth/",
  "/api/v1/invites/",
  "/api/v1/proposals/access/",
  "/api/v1/proposals/speakers/access/",
  "/api/v1/registrations/access/",
  // Meeting entry also accepts remembered-browser and personal-link credentials.
  "/api/v1/meetings/occurrences/",
  "/r/",
  "/donate/r/",
] as const;
const PRIMARY_READ_QUERY_KEYS = ["token", "signature", "session_id"] as const;

/** These projections never resolve the caller's identity, even with a cookie. */
function isPublicDirectoryRead(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/v1/members") return !url.searchParams.getAll("view").includes("staff");
  if (path === "/api/v1/sponsors") return !url.searchParams.getAll("visibility").includes("all");
  if (path === "/api/v1/members/wall" || path === "/api/v1/sponsors/display") return true;
  // Only the public logo subresource, not staff-only member/sponsor resources.
  return /^\/api\/v1\/(?:members|sponsors)\/[^/]+\/logo$/.test(path);
}

/**
 * A public read can start on any current replica. Authenticated, capability-
 * bearing, and state-changing requests start on primary so revocation and
 * writes are current; D1 may serve the remaining session queries from any
 * replica consistent with the bookmark established by that first query.
 */
export function requestD1SessionConstraint(request: Request): D1SessionConstraint {
  if (!READ_METHODS.has(request.method.toUpperCase())) return "first-primary";
  const url = new URL(request.url);
  if (PRIMARY_READ_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return "first-primary";
  if (PRIMARY_READ_QUERY_KEYS.some((key) => url.searchParams.has(key))) return "first-primary";
  if (isPublicDirectoryRead(url)) return "first-unconstrained";
  if (hasAuthenticationCredential(request)) return "first-primary";

  return "first-unconstrained";
}

export function withD1Session(db: DatabaseLike, constraint: D1SessionConstraint): DatabaseSessionLike {
  return db.withSession?.(constraint) ?? db;
}

export function readReplicaDb(db: DatabaseLike, bookmark?: string | null): DatabaseSessionLike {
  return db.withSession?.(bookmark || "first-unconstrained") ?? db;
}

export function primaryFirstDb(db: DatabaseLike): DatabaseSessionLike {
  return withD1Session(db, "first-primary");
}

export function requestSessionDb(db: DatabaseLike, request: Request): DatabaseSessionLike {
  return withD1Session(db, requestD1SessionConstraint(request));
}
