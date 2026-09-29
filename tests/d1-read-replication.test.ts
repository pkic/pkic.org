import { describe, expect, it } from "vitest";
import usersRouter from "../functions/api/v1/users/router";
import { cacheAdminForRequest, requireAdminFromRequest } from "../functions/_lib/auth/admin";
import { signUserSessionToken, verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import worker from "../functions/router";
import { requestD1SessionConstraint } from "../functions/_lib/db/session";
import { resilientDatabase } from "../functions/_lib/dependency-bindings";

const signingSecret = "test-admin-signing-secret";
const adminTokenExpiresAt = "2999-01-01T00:00:00.000Z";

async function createAdminToken(state?: string | null): Promise<string> {
  return signUserSessionToken(signingSecret, {
    sub: "admin-user",
    sid: "admin-session",
    exp: Math.floor(new Date(adminTokenExpiresAt).getTime() / 1000),
    state,
  });
}

interface StatementOptions {
  onQuery?: () => void;
  waitForQuery?: () => Promise<void>;
  bookmark?: string | null;
}

function emptyStatement(query: string, queries: string[], options: StatementOptions = {}): StatementLike {
  queries.push(query);
  return {
    bind() {
      return this;
    },
    async run() {
      return { success: true, meta: { changes: 0 } };
    },
    async all<T>() {
      options.onQuery?.();
      await options.waitForQuery?.();
      return { results: [] as T[] };
    },
    async first<T>() {
      if (query.includes("FROM sessions")) {
        return {
          id: "admin-session",
          subject_id: "admin-user",
          expires_at: adminTokenExpiresAt,
          created_at: new Date().toISOString(),
          revoked_at: null,
        } as T;
      }
      if (query.includes("SELECT id, email, role, active FROM users u WHERE u.id")) {
        return {
          id: "admin-user",
          email: "admin@example.test",
          role: "admin",
          active: 1,
        } as T;
      }
      if (query.includes("SELECT id, email, normalized_email FROM users WHERE id")) {
        return {
          id: "admin-user",
          email: "admin@example.test",
          normalized_email: "admin@example.test",
        } as T;
      }
      options.onQuery?.();
      await options.waitForQuery?.();
      return null;
    },
  };
}

function createDbWithSessionRecorder(options: StatementOptions = {}) {
  const primaryQueries: string[] = [];
  const sessionQueries: string[] = [];
  const withSessionCalls: string[] = [];

  const sessionDb: DatabaseLike & { getBookmark(): string | null } = {
    prepare(query) {
      if (query.includes("FROM sessions")) {
        throw new Error("admin auth should stay on the primary DB");
      }
      return emptyStatement(query, sessionQueries, options);
    },
    async batch(statements) {
      options.onQuery?.();
      await options.waitForQuery?.();
      return statements.map(() => ({ success: true, results: [], meta: { changes: 0 } }));
    },
    getBookmark() {
      return options.bookmark ?? null;
    },
  };

  const primaryDb: DatabaseLike = {
    prepare(query) {
      return emptyStatement(query, primaryQueries);
    },
    async batch() {
      return [];
    },
    withSession(constraintOrBookmark) {
      withSessionCalls.push(String(constraintOrBookmark));
      if (constraintOrBookmark === "first-primary") {
        return { ...sessionDb, prepare: (query) => emptyStatement(query, sessionQueries, options) };
      }
      return sessionDb;
    },
  };

  return { primaryDb, primaryQueries, sessionQueries, withSessionCalls };
}

describe("D1 read replication", () => {
  it.each([
    ["/api/v1/members", "first-unconstrained"],
    ["/api/v1/members?view=staff", "first-primary"],
    ["/api/v1/members?view=public&view=staff", "first-primary"],
    ["/api/v1/members/wall", "first-unconstrained"],
    ["/api/v1/members/capacities", "first-primary"],
    ["/api/v1/members/applications", "first-primary"],
    ["/api/v1/members/synthetic/logo", "first-unconstrained"],
    ["/api/v1/sponsors", "first-unconstrained"],
    ["/api/v1/sponsors?visibility=all", "first-primary"],
    ["/api/v1/sponsors/display", "first-unconstrained"],
    ["/api/v1/sponsors/synthetic/logo", "first-unconstrained"],
    ["/api/v1/sponsors/companies", "first-primary"],
    ["/api/v1/groups", "first-primary"],
    ["/api/v1/events", "first-primary"],
  ])("selects the correct session for a signed-in reader of %s", (path, expected) => {
    expect(
      requestD1SessionConstraint(
        new Request(`https://app.test${path}`, {
          headers: { cookie: "pkic_session=synthetic" },
        }),
      ),
    ).toBe(expected);
  });

  it.each([
    ["public GET", new Request("https://app.test/api/v1/members"), "first-unconstrained"],
    [
      "authenticated GET",
      new Request("https://app.test/api/v1/users/current", { headers: { cookie: "pkic_session=synthetic" } }),
      "first-primary",
    ],
    ["capability GET", new Request("https://app.test/api/v1/registrations/access/synthetic"), "first-primary"],
    ["meeting entry GET", new Request("https://app.test/api/v1/meetings/occurrences/synthetic/join"), "first-primary"],
    ["query-token GET", new Request("https://app.test/path?token=synthetic"), "first-primary"],
    ["state-changing request", new Request("https://app.test/api/v1/members", { method: "POST" }), "first-primary"],
  ])("selects the D1 session constraint for a %s", (_label, request, expected) => {
    expect(requestD1SessionConstraint(request)).toBe(expected);
  });

  it.each([undefined, "pkic_session=synthetic"])(
    "runs public API reads through a replica session with cookie %s",
    async (cookie) => {
      const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder();

      const response = await worker.fetch(
        new Request("https://app.test/api/v1/members?group=organization&limit=1", {
          headers: cookie ? { cookie } : {},
        }),
        { DB: primaryDb } as any,
        { passThroughOnException: () => {}, waitUntil: () => {} } as any,
      );

      expect(response.status).toBe(200);
      expect(withSessionCalls).toEqual(["first-unconstrained"]);
      expect(primaryQueries).toEqual([]);
      expect(sessionQueries.some((query) => query.includes("FROM members"))).toBe(true);
    },
  );

  it("preserves session bookmarks through dependency handling", () => {
    const db = resilientDatabase({
      prepare() {
        throw new Error("not used");
      },
      async batch() {
        return [];
      },
      getBookmark: () => "replica/bookmark",
    });

    expect(db.getBookmark?.()).toBe("replica/bookmark");
  });

  it("keeps full Worker authentication and subsequent reads in one primary-first session and rotates its bookmark", async () => {
    const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder({
      bookmark: "current/bookmark",
    });
    const token = await createAdminToken("prior/bookmark");
    const response = await worker.fetch(
      new Request("https://app.test/api/v1/users", { headers: { authorization: `Bearer ${token}` } }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException() {}, waitUntil() {} } as any,
    );
    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-primary"]);
    expect(primaryQueries).toEqual([]);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM users"))).toBe(true);
    const verified = await verifyUserSessionToken(signingSecret, response.headers.get("x-user-token")!);
    expect(verified.ok && verified.claims.state).toBe("current/bookmark");
  });

  it("uses a first-unconstrained D1 session for canonical staff GET reads after primary auth", async () => {
    const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder();
    const adminToken = await createAdminToken();

    const response = await usersRouter.fetch(
      new Request("https://app.test/", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(primaryQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(false);
    expect(sessionQueries.some((query) => query.includes("FROM users"))).toBe(true);
  });

  it("does not mutate the shared env DB binding while canonical staff GET reads are in flight", async () => {
    let releaseSessionQueries!: () => void;
    let markSessionQueryStarted!: () => void;
    const sessionQueryStarted = new Promise<void>((resolve) => {
      markSessionQueryStarted = resolve;
    });
    const waitForQuery = new Promise<void>((resolve) => {
      releaseSessionQueries = resolve;
    });
    const { primaryDb } = createDbWithSessionRecorder({
      onQuery: markSessionQueryStarted,
      waitForQuery: () => waitForQuery,
    });
    const env = { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any;
    const adminToken = await createAdminToken();

    const responsePromise = usersRouter.fetch(
      new Request("https://app.test/", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      env,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    await sessionQueryStarted;
    expect(env.DB).toBe(primaryDb);

    releaseSessionQueries();
    const response = await responsePromise;
    expect(response.status).toBe(200);
  });

  it("uses existing D1 bookmarks for canonical staff GET sessions and emits the next bookmark", async () => {
    const { primaryDb, withSessionCalls } = createDbWithSessionRecorder({ bookmark: "next/bookmark" });
    const adminToken = await createAdminToken("prior/bookmark");

    const response = await usersRouter.fetch(
      new Request("https://app.test/", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["prior/bookmark"]);
    const rotatedToken = response.headers.get("x-user-token");
    expect(rotatedToken).toBeTruthy();
    const verified = await verifyUserSessionToken(signingSecret, rotatedToken!);
    expect(verified.ok && verified.claims.state).toBe("next/bookmark");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("uses existing D1 bookmarks and rotates user-backed state for canonical Users reads", async () => {
    const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder({
      bookmark: "users/next-bookmark",
    });
    const adminToken = await createAdminToken("users/prior-bookmark");

    const response = await usersRouter.fetch(
      new Request("https://app.test/", { headers: { authorization: `Bearer ${adminToken}` } }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["users/prior-bookmark"]);
    expect(primaryQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(false);
    const rotatedToken = response.headers.get("x-user-token");
    const verified = await verifyUserSessionToken(signingSecret, rotatedToken!);
    expect(verified.ok && verified.claims.state).toBe("users/next-bookmark");
  });

  it("serves cached admin identities for the same request without another DB lookup", async () => {
    const request = new Request("https://app.test/admin", {
      headers: { authorization: "Bearer stale-token" },
    });
    const admin: AuthAdmin = createUserBackedAuthAdmin({
      id: "admin-user",
      email: "admin@example.test",
      role: "admin",
    });
    const throwingDb: DatabaseLike = {
      prepare() {
        throw new Error("unexpected DB lookup");
      },
      async batch() {
        return [];
      },
    };

    cacheAdminForRequest(request, admin);

    await expect(requireAdminFromRequest(throwingDb, request)).resolves.toEqual(admin);
  });
});
