import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { withDependencyHandling } from "../functions/_lib/dependency-bindings";
import { dependencyFailure } from "../functions/_lib/dependency-failure";
import { handleError } from "../functions/_lib/http";
import { AppError } from "../functions/_lib/errors";
import { dependencyFailureSchema } from "../assets/shared/schemas/dependency-failure";
import type { Env, StatementLike } from "../functions/_lib/types";
import { callApi } from "./helpers/app";

function failingDatabase(message: string): Env["DB"] {
  return {
    prepare: () => {
      throw new Error(message);
    },
    batch: async () => {
      throw new Error(message);
    },
  };
}

describe("dependency availability", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ["D1 DB is overloaded", "overloaded"],
    ["Network connection lost.", "connection_lost"],
    ["Replica disconnected from primary", "replica_disconnected"],
    ["A transient issue occurred", "transient_issue"],
    ["D1 DB exceeded timeout", "timeout"],
    ["D1 request timed out", "timeout"],
    ["D1 DB reset because its code was updated", "code_updated"],
    ["Internal error while starting up D1 DB storage caused object to be reset", "reset"],
    ["Service Unavailable", "service_unavailable"],
    ["Internal Error", "internal_error"],
    ["Response status 502", "http_5xx"],
  ])("logs a bounded reason for %s", (message, reason) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failure = dependencyFailure(new Error(message), "D1");

    expect(failure).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    expect(log).toHaveBeenCalledExactlyOnceWith("DEPENDENCY_UNAVAILABLE", {
      reference: dependencyFailureSchema.parse(failure?.details).reference,
      dependency: "D1",
      operation: "unknown",
      reason,
    });
  });

  it.each(["prepare", "first", "all", "run", "batch", "exec"] as const)(
    "logs the D1 %s operation without leaking provider text",
    async (operation) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fail = () => {
        throw new Error("Network connection lost. SELECT email FROM private_users WHERE email='private@example.test'");
      };
      const statement: StatementLike = { bind: () => statement, first: fail, all: fail, run: fail };
      const db = withDependencyHandling({
        ...env,
        DB: { prepare: operation === "prepare" ? fail : () => statement, batch: fail, exec: fail },
      }).DB;
      let failure: unknown;
      try {
        if (operation === "batch") await db.batch([]);
        else if (operation === "exec") await db.exec!("SELECT 1");
        else if (operation === "prepare") db.prepare("SELECT 1");
        else await db.prepare("SELECT ?").bind("private@example.test")[operation]();
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
      expect(log).toHaveBeenCalledExactlyOnceWith("DEPENDENCY_UNAVAILABLE", {
        reference: expect.any(String),
        dependency: "D1",
        operation,
        reason: "connection_lost",
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/SELECT|private_users|private@example/);
      expect(await handleError(failure).text()).not.toMatch(/SELECT|private_users|private@example/);
    },
  );

  it("logs the R2 operation without leaking object keys", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bucket = new Proxy(env.SPEAKER_UPLOADS_BUCKET!, {
      get(target, property) {
        if (property === "get")
          return () => Promise.reject(new Error("private/person/file.pdf: Internal Error (10001)"));
        return Reflect.get(target, property, target);
      },
    });
    const scoped = withDependencyHandling({ ...env, SPEAKER_UPLOADS_BUCKET: bucket });
    await expect(scoped.SPEAKER_UPLOADS_BUCKET!.get("private/person/file.pdf")).rejects.toMatchObject({ status: 503 });
    expect(log).toHaveBeenCalledExactlyOnceWith("DEPENDENCY_UNAVAILABLE", {
      reference: expect.any(String),
      dependency: "R2",
      operation: "get",
      reason: "internal_error",
      providerCode: "10001",
    });
  });

  it("returns a scoped unavailable error from the mounted application while configured mode is normal", async () => {
    const response = await callApi(
      { ...env, DB: failingDatabase("D1_ERROR: D1 DB is overloaded. Too many requests queued.") },
      "/api/v1/auth/request-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "outage@example.test" }),
      },
    );
    expect(response.status).toBe(503);
    const body = await response.json<{ error: { code: string; details: unknown } }>();
    expect(body.error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(dependencyFailureSchema.parse(body.error.details).capability).toBe("data");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("does not replay an ambiguous D1 batch and does not expose SQL", async () => {
    const batch = vi.fn(async () => {
      throw new Error("Network connection lost.");
    });
    const scoped = withDependencyHandling({ ...env, DB: { ...env.DB, prepare: env.DB.prepare.bind(env.DB), batch } });
    await expect(scoped.DB.batch([])).rejects.toMatchObject({ status: 503, code: "DEPENDENCY_UNAVAILABLE" });
    expect(batch).toHaveBeenCalledOnce();
  });

  it("preserves real D1 statement bindings and batch execution", async () => {
    const db = withDependencyHandling(env).DB;
    const results = await db.batch([db.prepare("SELECT ? AS value").bind("retained")]);
    expect(results[0].results).toEqual([{ value: "retained" }]);
    expect(await db.prepare("SELECT ? AS value").bind("read").first("value")).toBe("read");
  });

  it.each([
    "D1_ERROR: no such table: example",
    "D1_ERROR: UNIQUE constraint failed: private.email",
    "R2 put: InvalidArgument (400)",
  ])("does not disguise programming or validation errors: %s", async (message) => {
    expect(handleError(new Error(message)).status).toBe(500);
  });

  it("keeps access refusal distinct", () => {
    expect(handleError(new AppError(403, "FORBIDDEN", "No access")).status).toBe(403);
  });

  it("handles R2 failures through the same HTTP adapter", async () => {
    const app = new Hono();
    app.onError(handleError);
    app.get("/file", () => {
      throw new Error("R2 GET failed: Service Unavailable (503)");
    });
    const response = await app.request("/file");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { details: { capability: "files" } } });
  });
  it("preserves R2 missing-object and conditional-write semantics", async () => {
    const bucket = withDependencyHandling(env).SPEAKER_UPLOADS_BUCKET!;
    const key = `availability-${crypto.randomUUID()}`;
    expect(await bucket.get(key)).toBeNull();
    const stored = await bucket.put(key, "original");
    expect(stored).not.toBeNull();
    expect(await bucket.put(key, "replaced", { onlyIf: { etagMatches: "incorrect" } })).toBeNull();
    expect(await (await bucket.get(key))!.text()).toBe("original");
    await bucket.delete(key);
  });

  it.each([10001, 10043, 10058])("recognizes R2 service error %s", (code) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(handleError(new Error(`R2 get failed (${code})`)).status).toBe(503);
    expect(log).toHaveBeenCalledExactlyOnceWith("DEPENDENCY_UNAVAILABLE", {
      reference: expect.any(String),
      dependency: "R2",
      operation: "unknown",
      reason: "provider_service_error",
      providerCode: String(code),
    });
  });
});
