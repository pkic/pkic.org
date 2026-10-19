import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertIndividualMember } from "./helpers/membership";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
beforeEach(async () => {
  await resetDb();
  const { admin } = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, admin.id, "capacity-profile-admin");
});
async function target(state = "visible") {
  const person = await insertIndividualMember(env.DB, "H6", "capacity-profile@example.test");
  if (state !== "unaddressed") {
    await insertGroupSeat("capacity-profile", { publicRoster: true }, person);
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  if (state !== "overlap")
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  if (state === "hidden")
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(person.identityId).run();
  return person;
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
function patch(id: string, profile: unknown) {
  return callApi(env, `/api/v1/members/capacities/${id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${staff}`, "content-type": "application/json" },
    body: JSON.stringify({ profile }),
  });
}
describe("publication after capacity profile edits", () => {
  it.each(
    ["visible", "hidden", "unaddressed", "overlap"].flatMap((state) =>
      (state === "hidden" ? ["biography"] : ["biography", "links"]).map((field) => ({ state, field })),
    ),
  )("publishes changed person profiles and keeps repeats/private data quiet: %j", async ({ state, field }) => {
    const person = await target(state);
    const before = await readPublicPersonProfile(person.userId);
    const count = (await requests()).length;
    const value = field === "biography" ? "Published capacity biography" : ["https://example.test/capacity"];
    const changed = ["visible", "overlap"].includes(state);
    const response = await patch(person.identityId, { [field]: value });
    expect(response.status, await response.clone().text()).toBe(200);
    if (changed) expect(await readPublicPersonProfile(person.userId)).not.toEqual(before);
    else expect(await readPublicPersonProfile(person.userId)).toEqual(before);
    expect(await requests()).toHaveLength(count + Number(changed));
    if (changed)
      expect((await requests()).at(-1)).toMatchObject({
        resource_id: person.memberId,
        reason_code: "membership_changed",
      });
    expect((await patch(person.identityId, { [field]: value })).status).toBe(200);
    expect(await requests()).toHaveLength(count + Number(changed));
    expect((await patch(person.identityId, { [field]: field === "biography" ? null : [] })).status).toBe(200);
    expect(await readPublicPersonProfile(person.userId)).toEqual(before);
    expect(await requests()).toHaveLength(count + 2 * Number(changed));
  });
  it.each(["request", "audit"])("rolls back a person-only profile after %s failure and retries", async (failure) => {
    const person = await target();
    const before = await readPublicPersonProfile(person.userId);
    const state = async () => ({
      identity: await queryAll(env.DB, "SELECT biography,links_json,updated_at FROM identities WHERE id=?", [
        person.identityId,
      ]),
      audits: await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id"),
      requests: await requests(),
    });
    const persisted = await state();
    await env.DB.prepare(`CREATE TRIGGER fail_capacity_profile BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      WHEN ${failure === "request" ? "NEW.reason_code='membership_changed'" : "NEW.action='identity_updated'"}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CAPACITY_PROFILE_FAILURE'); END`).run();
    try {
      expect((await patch(person.identityId, { biography: "Retry biography" })).status).toBe(500);
      expect(await readPublicPersonProfile(person.userId)).toEqual(before);
      expect(await state()).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_capacity_profile").run();
    }
    expect((await patch(person.identityId, { biography: "Retry biography" })).status).toBe(200);
    expect(await readPublicPersonProfile(person.userId)).not.toEqual(before);
    expect(await requests()).toHaveLength(persisted.requests.length + 1);
  });
});
