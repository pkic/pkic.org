import type { DatabaseLike } from "../types";

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
export function isPublicDirectoryRead(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/api/v1/members") return !url.searchParams.getAll("view").includes("staff");
  if (path === "/api/v1/sponsors") return !url.searchParams.getAll("visibility").includes("all");
  if (path === "/api/v1/members/wall" || path === "/api/v1/sponsors/display") return true;
  // Only the public logo subresource, not staff-only member/sponsor resources.
  return /^\/api\/v1\/(?:members|sponsors)\/[^/]+\/logo$/.test(path);
}

/**
 * Reads, including authentication and authorization, may use a consistent
 * replica. Capability redemption and auth endpoints retain primary freshness;
 * state-changing requests start on primary and atomically recheck authority.
 */
export function requestD1SessionConstraint(request: Request): D1SessionConstraint {
  if (!READ_METHODS.has(request.method.toUpperCase())) return "first-primary";
  const url = new URL(request.url);
  if (PRIMARY_READ_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return "first-primary";
  if (PRIMARY_READ_QUERY_KEYS.some((key) => url.searchParams.has(key))) return "first-primary";
  if (isPublicDirectoryRead(url)) return "first-unconstrained";

  return "first-unconstrained";
}

export function withD1Session(db: DatabaseLike, constraint: D1SessionConstraint): DatabaseSessionLike {
  return db.withSession?.(constraint) ?? db;
}

export function readReplicaDb(db: DatabaseLike, bookmark?: string | null): DatabaseSessionLike {
  // Owner-approved policy (2026-10-21): read authorization may use replica state,
  // including a delay in observing permission or session revocations. Seconds of
  // replication lag are explicitly accepted; D1 provides no fixed maximum lag.
  // Bookmarks preserve sequential consistency, not immediate visibility of
  // another actor's revocation. This is an accepted product tradeoff, not a
  // security defect: do not force reads to primary solely to eliminate that lag.
  // Mutations still require atomic authorization against the primary.
  return db.withSession?.(bookmark || "first-unconstrained") ?? db;
}

export function primaryFirstDb(db: DatabaseLike): DatabaseSessionLike {
  return withD1Session(db, "first-primary");
}

export function requestSessionDb(db: DatabaseLike, request: Request, bookmark?: string | null): DatabaseSessionLike {
  const constraint = requestD1SessionConstraint(request);
  return constraint === "first-primary"
    ? primaryFirstDb(db)
    : readReplicaDb(db, isPublicDirectoryRead(new URL(request.url)) ? null : bookmark);
}
