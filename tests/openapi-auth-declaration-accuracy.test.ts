import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";

/**
 * A published authorization declaration is a security claim, and a wrong one is
 * worse than none: `required: false` on a route that actually authenticates
 * tells a reader the endpoint is open, and `required: true` on an open one
 * hides an unauthenticated surface.
 *
 * The budget test next door only counts declarations. This one checks a sample
 * of them against the Worker: routes declared public must not answer 401
 * without credentials, and routes declared as needing a session must.
 */
describe("OpenAPI authorization declarations match runtime behavior", () => {
  beforeEach(async () => {
    await resetDb();
  });

  const declaredPublic = ["/api/v1/groups/types", "/api/v1/groups", "/api/v1/votes", "/api/v1/votes/feed.rss"];

  it.each(declaredPublic)("%s is reachable without credentials, as declared", async (path) => {
    const response = await callApi(env, path);
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it("answers 404, not 401, for a path with no route — so the checks below mean something", async () => {
    const response = await callApi(env, "/api/v1/groups/any-group/not-a-real-resource");
    expect(response.status).toBe(404);
  });

  const declaredSessionRequired: [string, RequestInit?][] = [
    ["/api/v1/users/current/groups"],
    ["/api/v1/groups/any-group/context"],
    ["/api/v1/groups/any-group/votes"],
    ["/api/v1/groups/any-group/forms"],
    ["/api/v1/groups/any-group/events"],
    ["/api/v1/groups/any-group/vote-proposals"],
  ];

  it.each(declaredSessionRequired)("%s rejects an anonymous caller, as declared", async (path, init) => {
    const response = await callApi(env, path, init);
    // 401 specifically: a 404 here would mean the route resolves group identity
    // before authenticating, which leaks existence to anonymous callers.
    expect({ path, status: response.status }).toEqual({ path, status: 401 });
  });
});
