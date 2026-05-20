import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import { cacheAdminForRequest, requireAdminFromRequest } from "../functions/_lib/auth/admin";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";

function emptyStatement(query: string, queries: string[]): StatementLike {
  queries.push(query);
  return {
    bind() {
      return this;
    },
    async run() {
      return { success: true, meta: { changes: 0 } };
    },
    async all<T>() {
      return { results: [] as T[] };
    },
    async first<T>() {
      if (query.includes("FROM sessions")) {
        return {
          user_id: "admin-user",
          expires_at: "2999-01-01T00:00:00.000Z",
          revoked_at: null,
          email: "admin@example.test",
          role: "admin",
        } as T;
      }
      return null;
    },
  };
}

function createDbWithSessionRecorder() {
  const primaryQueries: string[] = [];
  const sessionQueries: string[] = [];
  const withSessionCalls: string[] = [];

  const sessionDb: DatabaseLike = {
    prepare(query) {
      if (query.includes("FROM sessions")) {
        throw new Error("admin auth should stay on the primary DB");
      }
      return emptyStatement(query, sessionQueries);
    },
    async batch() {
      return [];
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

    const response = await adminRouter.fetch(
      new Request("https://app.test/stats", {
        headers: { authorization: "Bearer admin-token" },
      }),
      { DB: primaryDb } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(primaryQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(false);
    expect(sessionQueries.some((query) => query.includes("FROM registrations"))).toBe(true);
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
