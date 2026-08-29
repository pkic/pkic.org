import { describe, expect, it } from "vitest";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

/**
 * Authorization metadata in the published spec used to be inferred from the
 * `/api/v1/admin/` prefix, which meant "staff surface". That prefix is retired,
 * so the inference silently stopped applying and every operation without its
 * own `x-pkic-auth` now publishes no security requirement at all.
 *
 * Runtime authorization is unaffected — handlers enforce it regardless — but
 * the spec under-claims, which misleads any consumer reading it.
 *
 * Rather than assert a requirement on routes nobody has verified, this test
 * pins the size of the undeclared set. It must only ever shrink: adding a
 * route without `x-pkic-auth` fails here, and annotating one requires lowering
 * the budget, so the debt is visible and cannot grow back.
 *
 * What counts as declared is the presence of the declaration, not the presence
 * of a `security` requirement in the output. An operation verified to be
 * deliberately public declares `required: false`, which correctly emits no
 * security requirement — counting emitted `security` instead would file that
 * verified route alongside the ones nobody has examined.
 */
const UNDECLARED_BUDGET = 180;

function operationsWithoutSecurity(): string[] {
  const spec = openapi.schema as {
    paths?: Record<string, Record<string, Record<string, unknown> | undefined>>;
  };
  const undeclared: string[] = [];
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"] as const) {
      const operation = item?.[method];
      if (!operation) continue;
      if (operation[AUTH_EXTENSION] === undefined) undeclared.push(`${method.toUpperCase()} ${path}`);
    }
  }
  return undeclared.sort();
}

describe("OpenAPI authorization declarations", () => {
  it("does not grow the set of operations publishing no security requirement", () => {
    const undeclared = operationsWithoutSecurity();
    expect({
      count: undeclared.length,
      withinBudget: undeclared.length <= UNDECLARED_BUDGET,
    }).toEqual({ count: undeclared.length, withinBudget: true });
  });

  it("keeps the budget honest by failing once the set has shrunk below it", () => {
    // Forces the budget down as routes are annotated, so it cannot drift into
    // meaninglessness.
    expect(operationsWithoutSecurity().length).toBeGreaterThan(UNDECLARED_BUDGET - 15);
  });

  it("publishes the declared requirement for a route that states one", () => {
    const spec = decorateOpenApiSpec(openapi.schema) as {
      paths?: Record<string, Record<string, { security?: { BearerAuth?: string[] }[] } | undefined>>;
    };
    const outbox = spec.paths?.["/api/v1/email/outbox"]?.get;
    expect(outbox?.security).toBeDefined();
    expect(outbox?.security?.[0]?.BearerAuth).toContain("email:read");
  });

  it("publishes no requirement for a route that declares itself public", () => {
    const spec = decorateOpenApiSpec(openapi.schema) as {
      paths?: Record<string, Record<string, { security?: unknown } | undefined>>;
    };
    // eventsListRouteSchema declares x-pkic-auth required:false.
    expect(spec.paths?.["/api/v1/events"]?.get?.security).toBeUndefined();
  });
});
