import { describe, expect, it } from "vitest";
import adminRouter from "../functions/api/v1/admin/router";
import usersRouter from "../functions/api/v1/users/router";
import { cacheAdminForRequest, requireAdminFromRequest } from "../functions/_lib/auth/admin";
import { signUserSessionToken, verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";

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
      if (query.includes("FROM events WHERE slug")) {
        return {
          id: "event-1",
          slug: "pqc-2026",
          name: "PQC 2026",
          timezone: "UTC",
          starts_at: null,
          ends_at: null,
          source_path: null,
          base_path: null,
          capacity_in_person: null,
          registration_mode: "open",
          visibility: "public",
          invite_limit_attendee: 5,
          invite_limit_speaker_nomination: 10,
          settings_json: "{}",
          owner_group_id: null,
          profile_key: null,
          source_mode: null,
          links_json: null,
          updated_at: new Date().toISOString(),
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
      new Request("https://app.test/events/pqc-2026/registrations", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(primaryQueries.some((query) => query.includes("FROM sessions"))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM sessions"))).toBe(false);
    expect(sessionQueries.some((query) => query.includes("FROM events"))).toBe(true);
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
      new Request("https://app.test/events/pqc-2026/registrations", {
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
      new Request("https://app.test/events/pqc-2026/registrations", {
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
