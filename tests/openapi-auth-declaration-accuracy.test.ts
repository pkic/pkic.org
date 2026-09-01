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
/**
 * A well-formed identifier that matches no row. Request validation runs before
 * the authorization guard, so a probe has to be structurally valid to reach the
 * guard at all — an unparseable id answers 400 and proves nothing either way.
 */
const ABSENT_ID = "00000000000000000000000000000000";

describe("OpenAPI authorization declarations match runtime behavior", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("answers 404, not 401, for a path with no route — so the checks below mean something", async () => {
    const response = await callApi(env, "/api/v1/groups/any-group/not-a-real-resource");
    expect(response.status).toBe(404);
  });

  const declaredPublic = [
    "/api/v1",
    "/api/v1/groups",
    "/api/v1/groups/types",
    "/api/v1/groups/any-group",
    "/api/v1/votes",
    "/api/v1/votes/feed.rss",
    "/api/v1/geolocation/country",
    "/api/v1/leadership/consortium-chairs",
    "/api/v1/invites/no-such-token/info",
    "/api/v1/registrations/access/no-such-token",
    "/api/v1/proposals/access/no-such-token",
    `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}/headshot`,
    "/api/v1/proposals/speakers/access/no-such-token",
    "/api/v1/proposals/speakers/access/no-such-token/headshot",
    "/api/v1/proposals/speakers/access/no-such-token/presentation",
  ];

  it.each(declaredPublic)("%s is reachable without credentials, as declared", async (path) => {
    const response = await callApi(env, path);
    // A public route may answer 404 for a token or slug that does not exist;
    // what it must never do is demand credentials.
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  const declaredPublicMutations: Array<{
    label: string;
    path: string;
    init: () => RequestInit;
  }> = [
    {
      label: "donation promoter creation",
      path: "/api/v1/donations/promoters",
      init: () => ({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "cs_test_missing" }),
      }),
    },
    {
      label: "proposal capability update",
      path: "/api/v1/proposals/access/no-such-token",
      init: () => ({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "withdrawn" }),
      }),
    },
    {
      label: "co-speaker invitation",
      path: "/api/v1/proposals/access/no-such-token/speakers",
      init: () => ({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "speaker@example.test", role: "speaker" }),
      }),
    },
    {
      label: "proposal speaker profile update",
      path: `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}`,
      init: () => ({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "speaker" }),
      }),
    },
    {
      label: "proposal speaker removal",
      path: `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}`,
      init: () => ({ method: "DELETE" }),
    },
    {
      label: "proposal speaker reminder",
      path: `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}/reminders`,
      init: () => ({ method: "POST" }),
    },
    {
      label: "proposal speaker headshot upload",
      path: `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}/headshot`,
      init: () => ({
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    },
    {
      label: "proposal speaker headshot removal",
      path: `/api/v1/proposals/access/no-such-token/speakers/${ABSENT_ID}/headshot`,
      init: () => ({ method: "DELETE" }),
    },
    {
      label: "speaker participation update",
      path: "/api/v1/proposals/speakers/access/no-such-token/participation",
      init: () => ({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "declined", reason: "Unavailable" }),
      }),
    },
    {
      label: "speaker profile update",
      path: "/api/v1/proposals/speakers/access/no-such-token/profile",
      init: () => ({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ biography: "Updated speaker profile" }),
      }),
    },
    {
      label: "speaker headshot upload",
      path: "/api/v1/proposals/speakers/access/no-such-token/headshot",
      init: () => ({
        method: "PUT",
        headers: { "content-type": "image/png" },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    },
    {
      label: "speaker headshot removal",
      path: "/api/v1/proposals/speakers/access/no-such-token/headshot",
      init: () => ({ method: "DELETE" }),
    },
    {
      label: "speaker presentation upload",
      path: "/api/v1/proposals/speakers/access/no-such-token/presentation",
      init: () => ({
        method: "PUT",
        headers: {
          "content-type": "application/pdf",
          "x-presentation-file-name": "slides.pdf",
          "x-presentation-file-size": "4",
        },
        body: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      }),
    },
    {
      label: "speaker reminder preference update",
      path: "/api/v1/proposals/speakers/access/no-such-token/reminder-preferences",
      init: () => ({
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "active" }),
      }),
    },
  ];

  it.each(declaredPublicMutations)("$label is reachable without credentials, as declared", async ({ path, init }) => {
    const response = await callApi(env, path, init());
    expect({ path, status: response.status }).not.toMatchObject({ status: 401 });
    expect({ path, status: response.status }).not.toMatchObject({ status: 403 });
  });

  const declaredSessionRequired = [
    "/api/v1/auth/session",
    "/api/v1/auth/passkeys",
    "/api/v1/users/current/groups",
    "/api/v1/groups/any-group/votes",
    "/api/v1/groups/any-group/forms",
    "/api/v1/groups/any-group/events",
    "/api/v1/groups/any-group/vote-proposals",
    "/api/v1/groups/any-group/mailing-lists",
    "/api/v1/groups/any-group/meetings/series",
    "/api/v1/users/current",
    "/api/v1/users/current/applications",
    `/api/v1/organizations/${ABSENT_ID}/identities`,
  ];

  it.each(declaredSessionRequired)("%s rejects an anonymous caller, as declared", async (path) => {
    const response = await callApi(env, path);
    // 401 specifically: a 404 here would mean the route resolves the resource
    // before authenticating, which leaks existence to anonymous callers.
    expect({ path, status: response.status }).toEqual({ path, status: 401 });
  });

  const declaredPermissionRequired = [
    "/api/v1/audit-log",
    "/api/v1/sponsors/companies",
    "/api/v1/members/applications",
    "/api/v1/leadership/positions?body=board",
  ];

  it.each(declaredPermissionRequired)("%s demands a permission, not merely a session", async (path) => {
    const response = await callApi(env, path);
    // Either is consistent with the declaration: the guard may reject the
    // missing session before it reaches the permission check.
    expect([401, 403]).toContain(response.status);
  });
});
