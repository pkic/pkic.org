import { createExecutionContext, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import app, { openapi } from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { AUTH_EXTENSION } from "../functions/_lib/openapi/mcp";
import { ALL_PERSONAS, ALL_PERSONA_KEYS, onlyPersona } from "./personas/catalog";
import type { Permission } from "../assets/shared/schemas/permissions";
import { personaRequest, seedPersona, type SeededPersona } from "./personas/seed";
import { TEST_GROUPS } from "./helpers/voting";
import { seedEventAndAdmin } from "./helpers/context";

/**
 * A system-wide authorization sweep, driven by the API's own declarations.
 *
 * Each route states the permissions it enforces through `x-pkic-auth`. That
 * declaration is a claim, and until now nothing checked it held: a route
 * could declare `audit:read` while its handler checked something else, or
 * nothing. Here every declaring route is actually called by somebody who
 * lacks the permission and by nobody at all, and must refuse both.
 *
 * The sweep grows on its own. Annotating another route brings it into scope
 * without anyone remembering to add a test, which is the property that makes
 * this cover the whole system rather than the parts someone got to.
 */
interface DeclaredOperation {
  path: string;
  method: "get";
  scopes: string[];
}

/** A well-formed identifier that matches no row, so path validation passes. */
const ABSENT_ID = "00000000000000000000000000000000";
const ABSENT_SLUG = "no-such-slug";

function fillPath(path: string): string | null {
  // Only sweep paths whose parameters can be filled with something
  // structurally valid. Anything else would answer 400 and prove nothing.
  const filled = path.replace(/\{([^}]+)\}/g, (_match, name: string) =>
    /slug|key|purpose|body|token/i.test(name) ? ABSENT_SLUG : ABSENT_ID,
  );
  return filled.includes("{") ? null : filled;
}

function declaredOperations(): DeclaredOperation[] {
  const spec = openapi.schema as {
    paths?: Record<string, Record<string, Record<string, unknown> | undefined>>;
  };
  const operations: DeclaredOperation[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    const operation = item?.get;
    if (!operation) continue;
    const auth = operation[AUTH_EXTENSION] as { required?: boolean; scopes?: string[] } | undefined;
    if (auth?.required !== true) continue;
    const scopes = auth.scopes ?? [];
    if (scopes.length === 0) continue; // Session-only; no permission boundary to sweep.
    if (!fillPath(path)) continue;
    operations.push({ path, method: "get", scopes });
  }
  return operations.sort((a, b) => a.path.localeCompare(b.path));
}

/** A persona holding none of `scopes`, used as the caller who must be refused. */
function personaWithout(scopes: string[]): string {
  const forbidden = new Set(scopes);
  const candidate = ALL_PERSONA_KEYS.find((key) => {
    const persona = ALL_PERSONAS[key];
    if (key === "anonymous") return false;
    if (persona.roles.some((role) => role.roleId === "role-admin")) return false;
    return persona.grants.every((grant) => !forbidden.has(grant));
  });
  if (!candidate) throw new Error(`No persona lacks ${scopes.join(", ")}`);
  return candidate;
}

describe("declared permissions are enforced", () => {
  const operations = declaredOperations();
  let outsider: SeededPersona;
  let anonymous: SeededPersona;
  let sweepEventId: string;

  beforeAll(async () => {
    await resetDb();
    const { eventId } = await seedEventAndAdmin(env.DB);
    sweepEventId = eventId;
    // `analyticsReader` holds one narrow permission, so it is an outsider to
    // almost every other route while still being a real, session-holding
    // staff identity — the case a route is most likely to get wrong.
    outsider = await seedPersona(env.DB, "analyticsReader", { groupId: TEST_GROUPS.pqc, eventId });
    anonymous = await seedPersona(env.DB, "anonymous");
  });

  async function call(request: Request): Promise<Response> {
    return app.fetch(request, env as never, createExecutionContext());
  }

  it("sweeps a meaningful number of routes", () => {
    // Guards against the sweep silently becoming empty if the declarations
    // or the path filter change shape.
    expect(operations.length).toBeGreaterThan(20);
  });

  it("refuses an anonymous caller on every declaring route", async () => {
    const allowed: string[] = [];
    for (const operation of operations) {
      const response = await call(new Request(new URL(fillPath(operation.path)!, "https://app.test")));
      if (response.status !== 401) allowed.push(`${operation.path} -> ${response.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it("refuses a signed-in caller who lacks the declared permission", async () => {
    const allowed: string[] = [];
    for (const operation of operations) {
      if (operation.scopes.includes("analytics:read")) continue; // The outsider holds this one.
      const response = await call(personaRequest(outsider, fillPath(operation.path)!));
      // 403 is the boundary. 404 is acceptable only where the resource is
      // resolved first and genuinely absent; anything 2xx means the declared
      // permission is not actually enforced.
      if (response.status < 400) allowed.push(`${operation.path} -> ${response.status}`);
    }
    expect(allowed).toEqual([]);
  });

  it("admits a caller holding exactly the declared permission and nothing else", async () => {
    // The other half of the boundary, and the one a suite testing through a
    // blanket administrator can never show: that a realistically scoped
    // identity can actually do the job. An administrator holds everything, so
    // it proves the route works for somebody — not that the permission the
    // route declares is the permission it needs.
    const refused: string[] = [];
    for (const operation of operations) {
      const holder = await seedPersona(
        env.DB,
        operation.scopes.map((scope) => onlyPersona(scope as Permission)),
        { groupId: TEST_GROUPS.pqc, eventId: sweepEventId },
      );
      const response = await call(personaRequest(holder, fillPath(operation.path)!));
      // 404 is fine: the identifiers match no row on purpose. 401 or 403 means
      // the declared permission is not sufficient, so the declaration is wrong.
      if (response.status === 401 || response.status === 403) {
        refused.push(`${operation.path} declares ${operation.scopes.join(", ")} -> ${response.status}`);
      }
    }
    expect(refused).toEqual([]);
  });

  it("names the personas it swept with", () => {
    expect(outsider.token).toBeTruthy();
    expect(anonymous.token).toBeNull();
    expect(personaWithout(["audit:read"])).toBeTruthy();
  });
});
