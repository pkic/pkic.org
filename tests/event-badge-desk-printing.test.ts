import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  badgeAttendeesResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  badgeLabelRequestSchema,
  badgePrintResponseSchema,
  type BadgeIssueRequest,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test/badges";

/** A member of the event's team, signed in, with only the role's own permissions. */
async function teamMember(roleId: "role-event_volunteer" | "role-program_committee") {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,active,first_name,last_name) VALUES(?,?,?,1,'Desk','Helper')",
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`)
    .run();
  await env.DB.prepare(
    "INSERT INTO user_roles (id,user_id,role_id,context_type,context_id,created_at) VALUES (?,?,?,'event',?,?)",
  )
    .bind(crypto.randomUUID(), id, roleId, fixture.eventId, new Date().toISOString())
    .run();
  return createAdminSession(env.DB, id, crypto.randomUUID());
}
function call(token: string, path: string, init: RequestInit = {}) {
  return callApi(env, `${base}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}
function issue(token: string, changes: Partial<BadgeIssueRequest> = {}) {
  const body = badgeIssueRequestSchema.parse({
    userId: fixture.userId,
    operationId: crypto.randomUUID(),
    reuseActive: true,
    ...changes,
  });
  return call(token, "", { method: "POST", body: JSON.stringify(body) });
}
const credentials = async () =>
  (await env.DB.prepare("SELECT id,revoked_at FROM event_badge_credentials ORDER BY id").all()).results;

describe("Badge printing at the desk", () => {
  beforeEach(() => fixture.setup());

  it("lets a volunteer find a registered attendee and print their badge", async () => {
    const token = await teamMember("role-event_volunteer");
    const found = await call(token, "/attendees");
    expect(found.status, await found.clone().text()).toBe(200);
    expect(badgeAttendeesResponseSchema.parse(await found.json()).users.map((user) => user.id)).toContain(
      fixture.userId,
    );
    expect((await call(token, "/printing")).status).toBe(200);

    const issued = await issue(token);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const badge = badgeIssueResponseSchema.parse(await issued.json());
    for (const label of [
      { source: "badge", badgeId: badge.id, operationId: crypto.randomUUID() },
      { source: "scan", credential: fixture.badgeId, operationId: crypto.randomUUID() },
    ]) {
      const printed = await call(token, "/labels", {
        method: "POST",
        body: JSON.stringify(badgeLabelRequestSchema.parse(label)),
      });
      expect(printed.status, await printed.clone().text()).toBe(200);
      badgePrintResponseSchema.parse(await printed.json());
    }
  });

  it("keeps badge management to organizers with event management", async () => {
    const token = await teamMember("role-event_volunteer");
    const badge = badgeIssueResponseSchema.parse(await (await issue(token)).json());
    const before = await credentials();
    for (const [path, init] of [
      ["", {}],
      [`/${badge.id}`, {}],
      [`/${badge.id}`, { method: "DELETE" }],
    ] as const)
      expect((await call(token, path, init)).status).toBe(403);
    expect((await issue(token, { reuseActive: undefined })).status).toBe(403);
    expect((await issue(token, { reuseActive: undefined, replaceBadgeId: badge.id })).status).toBe(403);
    expect(await credentials()).toEqual(before);
  });

  it.each(["pending_email_confirmation", "cancelled"])(
    "prints no badge at the desk for a %s registration",
    async (status) => {
      await env.DB.prepare("UPDATE registrations SET status=? WHERE event_id=? AND user_id=?")
        .bind(status, fixture.eventId, fixture.userId)
        .run();
      const token = await teamMember("role-event_volunteer");
      const before = await credentials();
      expect((await issue(token)).status).toBe(409);
      expect(await credentials()).toEqual(before);
    },
  );

  it("gives the program committee no badge printing", async () => {
    const token = await teamMember("role-program_committee");
    expect((await call(token, "/attendees")).status).toBe(403);
    expect((await issue(token)).status).toBe(403);
  });
});
