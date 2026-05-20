import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import {
  cacheAdminForRequest,
  requireAdminFromRequest,
  signAdminSessionToken,
  verifyAdminSessionToken,
} from "../functions/_lib/auth/admin";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";

const signingSecret = "test-admin-signing-secret";
const adminTokenExpiresAt = "2999-01-01T00:00:00.000Z";

async function createAdminToken(state?: string | null): Promise<string> {
  return signAdminSessionToken(signingSecret, {
    admin: { id: "admin-user", email: "admin@example.test", role: "admin" },
    sessionId: "admin-session",
    expiresAt: adminTokenExpiresAt,
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
          user_id: "admin-user",
          expires_at: adminTokenExpiresAt,
          revoked_at: null,
          email: "admin@example.test",
          role: "admin",
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
    async batch() {
      return [];
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
      return sessionDb;
    },
  };

  return { primaryDb, primaryQueries, sessionQueries, withSessionCalls };
}

describe("D1 read replication", () => {
  it("uses a first-unconstrained D1 session for admin GET reads after primary auth", async () => {
    const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder();
    const adminToken = await createAdminToken();

    const response = await adminRouter.fetch(
      new Request("https://app.test/stats", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(primaryQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(false);
    expect(sessionQueries.some((query) => query.includes("FROM registrations"))).toBe(true);
  });

  it("does not mutate the shared env DB binding while admin GET reads are in flight", async () => {
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

    const responsePromise = adminRouter.fetch(
      new Request("https://app.test/stats", {
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

  it("uses existing D1 bookmarks for admin GET sessions and emits the next bookmark", async () => {
    const { primaryDb, withSessionCalls } = createDbWithSessionRecorder({ bookmark: "next/bookmark" });
    const adminToken = await createAdminToken("prior/bookmark");

    const response = await adminRouter.fetch(
      new Request("https://app.test/stats", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["prior/bookmark"]);
    const rotatedToken = response.headers.get("x-admin-token");
    expect(rotatedToken).toBeTruthy();
    const verified = await verifyAdminSessionToken(signingSecret, rotatedToken!);
    expect(verified.ok && verified.claims.state).toBe("next/bookmark");
    expect(response.headers.has("set-cookie")).toBe(false);
  });

  it("serves cached admin identities for the same request without another DB lookup", async () => {
    const request = new Request("https://app.test/admin", {
      headers: { authorization: "Bearer stale-token" },
    });
    const admin: AuthAdmin = { id: "admin-user", email: "admin@example.test", role: "admin" };
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
