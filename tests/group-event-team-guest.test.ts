/**
 * The event's team works on the event through the owning group's workspace without joining the group: the team
 * member is the group's guest, who reaches that one event's record and none of the group's member views.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { groupLabelSchema, type GROUP_VISIBILITIES } from "../assets/shared/schemas/groups";
import { createGroup } from "../functions/_lib/services/groups";
import { grantEventTeamRole } from "../functions/_lib/services/events/team";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";
import { grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function person(label: string) {
  const id = await insertUser(env.DB, `${label}-${crypto.randomUUID()}@example.test`);
  return { id, token: await createAdminSession(env.DB, id, `${label}-${crypto.randomUUID()}`) };
}

function get(token: string, path: string): Promise<Response> {
  return callApi(env, path, { headers: { authorization: `Bearer ${token}` } });
}

async function createEvent(administrator: { token: string }, groupId: string, label: string) {
  const response = await callApi(env, `/api/v1/groups/${groupId}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${administrator.token}`, "content-type": "application/json" },
    body: JSON.stringify({
      slug: `${label}-${crypto.randomUUID()}`,
      name: "Team workshop",
      timezone: "Europe/Amsterdam",
      startsAt: "2027-04-12T08:00:00.000Z",
      endsAt: "2027-04-12T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      inviteLimitAttendee: 5,
    }),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { event: { id: string; slug: string } }).event;
}

async function fixture(visibility: (typeof GROUP_VISIBILITIES)[number]) {
  const administrator = await person("guest-administrator");
  const actor: UserBackedAuthAdmin = {
    identityType: "user",
    id: administrator.id,
    email: "administrator@example.test",
    grants: await grantAdministrator(env.DB, administrator.id),
  };
  const group = await createGroup(env.DB, actor, {
    typeKey: "working_group",
    name: `Guest group ${crypto.randomUUID()}`,
    visibility,
    eligibilityMode: "open",
  });
  const event = await createEvent(administrator, group.id, "team-event");
  const otherEvent = await createEvent(administrator, group.id, "other-event");
  const volunteer = await person("guest-volunteer");
  const assignment = await grantEventTeamRole(env.DB, actor, event.slug, { userId: volunteer.id, role: "volunteer" });
  return { group, event, otherEvent, volunteer, assignment, outsider: await person("guest-outsider") };
}

describe("a group's guest", () => {
  it("opens their event's record and none of the group's member views", async () => {
    const { group, event, otherEvent, volunteer, outsider } = await fixture("authenticated");

    const detail = await get(volunteer.token, `/api/v1/groups/${group.id}`);
    expect(((await detail.json()) as { capabilities: string[] }).capabilities).toEqual(["view", "guest"]);
    const record = await get(volunteer.token, `/api/v1/groups/${group.id}/events/${event.id}`);
    expect(record.status).toBe(200);
    expect(((await record.json()) as { event: { capabilities: string[] } }).event.capabilities).toEqual(["view"]);

    for (const path of [
      `/api/v1/groups/${group.id}/events/${otherEvent.id}`,
      `/api/v1/groups/${group.id}/events/${event.id}/registrations`,
      `/api/v1/groups/${group.id}/memberships`,
    ]) {
      expect((await get(volunteer.token, path)).status, path).toBeGreaterThanOrEqual(403);
    }
    // The event page names the group whose workspace opens it, to the team only.
    await env.DB.prepare("UPDATE events SET visibility = 'public' WHERE id = ?").bind(event.id).run();
    const pageFor = async (token: string) => {
      const page = await get(token, `/api/v1/events/${event.slug}`);
      expect(page.status).toBe(200);
      return ((await page.json()) as { event: { ownerGroupId?: string } }).event;
    };
    expect((await pageFor(volunteer.token)).ownerGroupId).toBe(group.id);
    expect(await pageFor(outsider.token)).not.toHaveProperty("ownerGroupId");
    // Someone with no capacity at all reads groups as the public does.
    expect((await get(outsider.token, `/api/v1/groups/${group.id}/events/${event.id}`)).status).toBe(401);
  });

  it("reaches a group no one else may see only as its guest, until the team role ends", async () => {
    const { group, event, volunteer, assignment, outsider } = await fixture("managed");

    const detail = await get(volunteer.token, `/api/v1/groups/${group.id}`);
    expect(await detail.json()).toEqual({
      kind: "guest",
      group: groupLabelSchema.parse(group),
      capabilities: ["guest"],
    });
    expect((await get(volunteer.token, `/api/v1/groups/${group.id}/events/${event.id}`)).status).toBe(200);
    // Every other group surface treats the guest as anyone else who may not see the group.
    expect((await get(volunteer.token, `/api/v1/groups/${group.id}/events`)).status).toBe(404);
    expect((await get(outsider.token, `/api/v1/groups/${group.id}`)).status).toBe(404);

    await env.DB.prepare("UPDATE user_roles SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .bind(assignment.id)
      .run();
    expect((await get(volunteer.token, `/api/v1/groups/${group.id}`)).status).toBe(404);
    expect((await get(volunteer.token, `/api/v1/groups/${group.id}/events/${event.id}`)).status).toBe(401);
  });
});
