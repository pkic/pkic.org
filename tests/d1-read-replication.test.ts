import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { resetDb } from "./helpers/reset-db";
import { insertUser } from "./helpers/membership";
import { grantAdministrator } from "./helpers/administrator";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { cacheAdminForRequest, requireAdminFromRequest } from "../functions/_lib/auth/admin";
import { signUserSessionToken, verifyUserSessionToken } from "../functions/_lib/auth/user-session";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../functions/_lib/types";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import worker from "./helpers/app";
import { requestD1SessionConstraint } from "../functions/_lib/db/session";
import { seedEventAndAdmin } from "./helpers/context";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { withRequestD1Session } from "../functions/_lib/db/request-session";
import { serializeUserSessionCookie } from "../functions/_lib/auth/user-session-token";
import { resilientDatabase } from "../functions/_lib/dependency-bindings";
import { isReadOnlySql } from "../functions/_lib/db/read-only-sql";

const signingSecret = "test-admin-signing-secret";

async function createAdminToken(state?: string | null, email = "admin@example.test"): Promise<string> {
  const userId = await insertUser(env.DB, email);
  await grantAdministrator(env.DB, userId);
  const token = await createAdminSession(env.DB, userId, crypto.randomUUID(), signingSecret);
  const verified = await verifyUserSessionToken(signingSecret, token);
  if (!verified.ok) throw new Error("Expected a valid staff fixture session");
  return signUserSessionToken(signingSecret, {
    sub: verified.claims.sub,
    sid: verified.claims.sid,
    exp: verified.claims.exp,
    state,
  });
}

interface StatementOptions {
  onQuery?: () => void;
  waitForQuery?: () => Promise<void>;
  bookmark?: string | null;
}

function recordedStatement(database: DatabaseLike, query: string, queries: string[]): StatementLike {
  queries.push(query);
  return database.prepare(query);
}

function createDbWithSessionRecorder(options: StatementOptions = {}) {
  const database: DatabaseLike = env.DB;
  const sessionDatabase = mutateBeforeMatchingQuery(
    database,
    () => true,
    async () => {
      options.onQuery?.();
      await options.waitForQuery?.();
    },
  );
  const primaryQueries: string[] = [];
  const sessionQueries: string[] = [];
  const withSessionCalls: string[] = [];

  const sessionDb: DatabaseLike & { getBookmark(): string | null } = {
    prepare(query) {
      return recordedStatement(sessionDatabase, query, sessionQueries);
    },
    async batch(statements) {
      return sessionDatabase.batch(statements);
    },
    getBookmark() {
      return options.bookmark ?? null;
    },
  };

  const primaryDb: DatabaseLike = {
    prepare(query) {
      return recordedStatement(database, query, primaryQueries);
    },
    batch: (statements) => database.batch(statements),
    withSession(constraintOrBookmark) {
      withSessionCalls.push(String(constraintOrBookmark));
      if (constraintOrBookmark === "first-primary") {
        return { ...sessionDb, prepare: (query) => recordedStatement(sessionDatabase, query, sessionQueries) };
      }
      return sessionDb;
    },
  };

  return { primaryDb, primaryQueries, sessionQueries, withSessionCalls };
}

describe("D1 read replication", () => {
  beforeEach(resetDb);
  it.each([
    ["/api/v1/members", "first-unconstrained"],
    ["/api/v1/members?view=staff", "first-unconstrained"],
    ["/api/v1/members?view=public&view=staff", "first-unconstrained"],
    ["/api/v1/members/wall", "first-unconstrained"],
    ["/api/v1/members/capacities", "first-unconstrained"],
    ["/api/v1/members/applications", "first-unconstrained"],
    ["/api/v1/members/synthetic/logo", "first-unconstrained"],
    ["/api/v1/sponsors", "first-unconstrained"],
    ["/api/v1/sponsors?visibility=all", "first-unconstrained"],
    ["/api/v1/sponsors/display", "first-unconstrained"],
    ["/api/v1/sponsors/synthetic/logo", "first-unconstrained"],
    ["/api/v1/sponsors/companies", "first-unconstrained"],
    ["/api/v1/groups", "first-unconstrained"],
    ["/api/v1/events", "first-unconstrained"],
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
      "first-unconstrained",
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

  it("keeps full Worker authentication and reads in the bookmarked replica session and rotates its bookmark", async () => {
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
    expect(withSessionCalls).toEqual(["prior/bookmark"]);
    expect(primaryQueries).toEqual([]);
    expect(sessionQueries.some((query) => /\b(?:FROM|JOIN) sessions\b/u.test(query))).toBe(true);
    expect(sessionQueries.some((query) => query.includes("FROM users"))).toBe(true);
    const verified = await verifyUserSessionToken(signingSecret, response.headers.get("x-user-token")!);
    expect(verified.ok && verified.claims.state).toBe("current/bookmark");
  });

  it("uses one replica session for canonical staff authentication and GET reads", async () => {
    const { primaryDb, primaryQueries, sessionQueries, withSessionCalls } = createDbWithSessionRecorder();
    const adminToken = await createAdminToken();

    const response = await worker.fetch(
      new Request("https://app.test/api/v1/users", {
        headers: { authorization: `Bearer ${adminToken}` },
      }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(primaryQueries).toEqual([]);
    expect(sessionQueries.some((query) => /\b(?:FROM|JOIN) sessions\b/u.test(query))).toBe(true);
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

    const responsePromise = worker.fetch(
      new Request("https://app.test/api/v1/users", {
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

    const response = await worker.fetch(
      new Request("https://app.test/api/v1/users", {
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

    const response = await worker.fetch(
      new Request("https://app.test/api/v1/users", { headers: { authorization: `Bearer ${adminToken}` } }),
      { DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret } as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["users/prior-bookmark"]);
    expect(primaryQueries).toEqual([]);
    expect(sessionQueries.some((query) => /\b(?:FROM|JOIN) sessions\b/u.test(query))).toBe(true);
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
  it("keeps agenda reads read-only and carries a save bookmark into the next request", async () => {
    const { eventId, admin } = await seedEventAndAdmin(env.DB);
    const token = await createAdminSession(env.DB, admin.id, crypto.randomUUID(), signingSecret);
    const created = await createAgendaOccurrence(
      env.DB,
      eventId,
      "pqc-2026",
      agendaOccurrenceCreateSchema.parse({
        expectedRevision: 0,
        title: "Replica agenda fixture",
        startAt: null,
        endAt: null,
        roomId: null,
      }),
    );
    const recorder = createDbWithSessionRecorder({ bookmark: "agenda/after-save" });
    const environment = { ...env, DB: recorder.primaryDb, INTERNAL_SIGNING_SECRET: signingSecret };
    const get = (token: string) =>
      worker.fetch(
        new Request("https://app.test/api/v1/events/pqc-2026/agenda", {
          headers: { authorization: `Bearer ${token}` },
        }),
        environment,
        createExecutionContext(),
      );
    const before = await get(token);
    expect(before.status, await before.clone().text()).toBe(200);
    expect(recorder.sessionQueries.length).toBeGreaterThan(0);
    expect(recorder.sessionQueries.every(isReadOnlySql)).toBe(true);
    recorder.sessionQueries.length = 0;
    const saved = await worker.fetch(
      new Request(`https://app.test/api/v1/events/pqc-2026/agenda/occurrences/${created.occurrences[0]!.id}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedRevision: created.revision, title: "Saved on primary" }),
      }),
      environment,
      createExecutionContext(),
    );
    expect(saved.status, await saved.clone().text()).toBe(200);
    const snapshot = agendaSnapshotSchema.parse(await saved.json());
    expect(snapshot.occurrences[0]!.title).toBe("Saved on primary");
    expect(
      recorder.sessionQueries.filter(
        (sql) => /INSERT INTO authorization_guards/.test(sql) && sql.includes("WITH required"),
      ),
    ).toHaveLength(1);
    const nextToken = saved.headers.get("x-user-token")!;
    const claims = await verifyUserSessionToken(signingSecret, nextToken);
    expect(claims.ok && claims.claims.state).toBe("agenda/after-save");
    const after = await get(nextToken);
    expect(after.status).toBe(200);
    expect(recorder.withSessionCalls).toEqual(["first-unconstrained", "first-primary", "agenda/after-save"]);
    expect(recorder.primaryQueries).toEqual([]);
  });

  it("rotates cookie bookmarks without extending activity or changing the acting identity", async () => {
    const initial = await createAdminToken("cookie/prior");
    const verified = await verifyUserSessionToken(signingSecret, initial);
    if (!verified.ok) throw new Error("Expected fixture claims");
    const activity = Math.floor(Date.now() / 1000) - 120;
    const token = await signUserSessionToken(signingSecret, {
      ...verified.claims,
      identityId: "selected-identity",
      lastActivityAt: activity,
      staffLastActivityAt: activity,
    });
    const { primaryDb } = createDbWithSessionRecorder({ bookmark: "cookie/next" });
    const response = await withRequestD1Session(
      new Request("https://app.test/api/v1/users", {
        method: "POST",
        headers: { cookie: `pkic_session=${token}` },
      }),
      { ...env, DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
      async () => new Response(null, { status: 200 }),
    );
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.startsWith("pkic_session="))!;
    const rotated = await verifyUserSessionToken(signingSecret, cookie.split(";")[0]!.slice("pkic_session=".length));
    expect(rotated.ok && rotated.claims).toMatchObject({
      state: "cookie/next",
      iid: "selected-identity",
      exp: verified.claims.exp,
      lastActivityAt: activity,
      staffLastActivityAt: activity,
    });
  });
  it.each(["GET", "HEAD"])("does not let a late %s cookie response replace a save bookmark", async (method) => {
    const token = await createAdminToken("cookie/before-save");
    const read = createDbWithSessionRecorder({ bookmark: "cookie/older-read" });
    const write = createDbWithSessionRecorder({ bookmark: "cookie/after-save" });
    let finishRead!: () => void;
    let readStarted!: () => void;
    const pendingRead = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const started = new Promise<void>((resolve) => {
      readStarted = resolve;
    });
    const readResponse = withRequestD1Session(
      new Request("https://app.test/api/v1/users/current", {
        method,
        headers: { cookie: `pkic_session=${token}` },
      }),
      { ...env, DB: read.primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
      async () => {
        readStarted();
        await pendingRead;
        return new Response(null, { status: 200 });
      },
    );
    await started;
    let savedCookie = "";
    try {
      const saved = await withRequestD1Session(
        new Request("https://app.test/api/v1/users/current", {
          method: "PATCH",
          headers: { cookie: `pkic_session=${token}` },
        }),
        { ...env, DB: write.primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
        async () => new Response(null, { status: 200 }),
      );
      savedCookie = saved.headers.getSetCookie().find((value) => value.startsWith("pkic_session="))!;
    } finally {
      finishRead();
    }
    const late = await readResponse;
    expect(late.headers.has("set-cookie")).toBe(false);
    expect(late.headers.has("x-user-token")).toBe(false);
    const next = createDbWithSessionRecorder();
    await withRequestD1Session(
      new Request("https://app.test/api/v1/users/current", { headers: { cookie: savedCookie.split(";")[0]! } }),
      { ...env, DB: next.primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
      async () => new Response(null, { status: 200 }),
    );
    expect(next.withSessionCalls).toEqual(["cookie/after-save"]);
  });
  it("does not replace an authenticated bookmark during an unconstrained public directory read", async () => {
    const token = await createAdminToken("private/bookmark");
    const { primaryDb, withSessionCalls } = createDbWithSessionRecorder({ bookmark: "unconstrained/public" });
    const response = await worker.fetch(
      new Request("https://app.test/api/v1/members?limit=1", {
        headers: { cookie: `pkic_session=${token}` },
      }),
      { ...env, DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
      createExecutionContext(),
    );
    expect(response.status).toBe(200);
    expect(withSessionCalls).toEqual(["first-unconstrained"]);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.has("x-user-token")).toBe(false);
  });
  it("attaches the committed bookmark to a newly issued login cookie and preserves its identity and activity", async () => {
    const oldToken = await createAdminToken("old/bookmark");
    const newToken = await createAdminToken("new/bookmark", "new-login@example.test");
    const verified = await verifyUserSessionToken(signingSecret, newToken);
    if (!verified.ok) throw new Error("Expected new login claims");
    const { primaryDb, withSessionCalls } = createDbWithSessionRecorder({ bookmark: "login/committed" });
    const request = new Request("https://app.test/api/v1/auth/verify-link", {
      method: "POST",
      headers: { cookie: `pkic_session=${oldToken}` },
    });
    const response = await withRequestD1Session(
      request,
      { ...env, DB: primaryDb, INTERNAL_SIGNING_SECRET: signingSecret },
      async () => {
        const headers = new Headers();
        headers.append("Set-Cookie", "other_cookie=preserved; Secure");
        headers.append("Set-Cookie", serializeUserSessionCookie(newToken, request));
        return new Response(null, { status: 200, headers });
      },
    );
    const cookies = response.headers.getSetCookie();
    expect(cookies).toContain("other_cookie=preserved; Secure");
    const userCookie = cookies.find((cookie) => cookie.startsWith("pkic_session="))!;
    const rotated = await verifyUserSessionToken(
      signingSecret,
      userCookie.split(";")[0]!.slice("pkic_session=".length),
    );
    expect(rotated.ok && rotated.claims).toEqual({ ...verified.claims, state: "login/committed" });
    expect(withSessionCalls).toEqual(["first-primary"]);
  });
});
