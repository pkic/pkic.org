import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { nowIso } from "../functions/_lib/utils/time";
import { administratorGrants, grantAdministrator } from "./helpers/administrator";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { queryAll } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

import { updateSponsorship } from "../functions/_lib/services/sponsorship/pipeline";
import { authorizedSponsorshipMutationDb } from "../functions/_lib/services/sponsorship/authorization";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { UserBackedAuthAdmin } from "../functions/_lib/types";

let token: string;
let actor: UserBackedAuthAdmin;
beforeEach(async () => {
  await resetDb();
  const id = await insertUser(env.DB, "nonmember-content-admin@example.test");
  await grantAdministrator(env.DB, id);
  actor = { identityType: "user", id, email: "nonmember-content-admin@example.test", grants: administratorGrants };
  token = await createAdminSession(env.DB, id, "nonmember-content-admin");
});
async function fixture(type = "consortium", listed = true) {
  const id = crypto.randomUUID(),
    eventId = type === "event" ? crypto.randomUUID() : null,
    at = nowIso();
  if (eventId)
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES(?,'nonmember-logo-event','Non-member logo event','UTC','invitation_only',?,?)",
    )
      .bind(eventId, at, at)
      .run();
  const key = null;

  await env.DB.prepare(`INSERT INTO sponsorships(id,sponsor_type,non_member_name,non_member_logo_r2_key,event_id,tier,pipeline_stage,renewal_date,created_at,updated_at)
    VALUES(?,?,'Public non-member sponsor',?,?,?,?,'2035-12-31',?,?)`)
    .bind(id, type, key, eventId, type === "event" ? "Leader" : "Gold", listed ? "active" : "new_inquiry", at, at)
    .run();
  const selections: Array<Record<string, string | undefined>> = eventId
    ? [{ eventSlug: "nonmember-logo-event" }]
    : [{}];
  return { id, eventId, selections, key };
}
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_type,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");
async function patch(f: Awaited<ReturnType<typeof fixture>>, body: Record<string, unknown>) {
  return callApi(env, `/api/v1/sponsors/${f.id}`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const snapshot = (f: Awaited<ReturnType<typeof fixture>>) => readSitePublicationSnapshot(env.DB, f.selections);
it.each(
  ["consortium", "event"].flatMap((type) =>
    ["nonMemberName", "nonMemberWebsite", "tier"].map((field) => ({ type, field })),
  ),
)("publishes public non-member sponsor edits %j", async ({ type, field }) => {
  const f = await fixture(type),
    before = (await snapshot(f)).sponsors;
  const value =
    field === "nonMemberName"
      ? "Changed public sponsor"
      : field === "nonMemberWebsite"
        ? "https://sponsor.example.test/"
        : type === "event"
          ? "Ambassador"
          : "Silver";
  const response = await patch(f, { [field]: value });
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await snapshot(f)).sponsors).not.toEqual(before);
  expect(await requests()).toEqual([
    expect.objectContaining({ resource_type: "sponsorship", resource_id: f.id, reason_code: "sponsorship_changed" }),
  ]);
});

it.each(
  ["consortium", "event"].flatMap((type) =>
    ["appearance", "withdrawal", "tier-appearance", "tier-withdrawal"].map((change) => ({ type, change })),
  ),
)("publishes visibility transitions %j", async ({ type, change }) => {
  const f = await fixture(type);
  if (change === "appearance")
    await env.DB.prepare("UPDATE sponsorships SET non_member_name=NULL WHERE id=?").bind(f.id).run();
  if (change === "tier-appearance")
    await env.DB.prepare("UPDATE sponsorships SET tier='Unknown' WHERE id=?").bind(f.id).run();
  const body =
    change === "appearance"
      ? { nonMemberName: "New public sponsor" }
      : change === "withdrawal"
        ? { nonMemberName: null }
        : { tier: change === "tier-appearance" ? (type === "event" ? "Leader" : "Gold") : null };
  const before = (await snapshot(f)).sponsors;
  expect((await patch(f, body)).status).toBe(200);
  expect((await snapshot(f)).sponsors).not.toEqual(before);
  expect(await requests()).toHaveLength(1);
});
it.each([
  { notes: "Private staff note" },
  { contactName: "Private contact" },
  { contactEmail: "private@example.test" },
  { renewalDate: "2036-01-01" },
  { nonMemberName: "Public non-member sponsor" },
  { nonMemberWebsite: null },
  { tier: "Gold" },
  {},
])("keeps unchanged public data quiet for %j", async (body) => {
  const f = await fixture(),
    before = (await snapshot(f)).sponsors;
  expect((await patch(f, body)).status).toBe(200);
  expect((await snapshot(f)).sponsors).toEqual(before);
  expect(await requests()).toEqual([]);
});
it.each(["consortium", "event"])("keeps hidden %s data edits quiet", async (type) => {
  const f = await fixture(type, false),
    before = (await snapshot(f)).sponsors;
  expect(
    (
      await patch(f, {
        nonMemberName: "Private sponsor",
        nonMemberWebsite: "https://private.example.test/",
        tier: type === "event" ? "Ambassador" : "Silver",
      })
    ).status,
  ).toBe(200);
  expect((await snapshot(f)).sponsors).toEqual(before);
  expect(await requests()).toEqual([]);
});
it.each(["request", "audit"])("rolls back the patch after %s failure and retries once", async (failure) => {
  const f = await fixture(),
    before = (await snapshot(f)).sponsors;
  const state = () =>
    queryAll(env.DB, "SELECT non_member_name,tier,updated_at,transition_revision FROM sponsorships WHERE id=?", [f.id]);
  const previous = await state();
  await env.DB.prepare(
    failure === "request"
      ? "CREATE TRIGGER fail_nonmember_patch BEFORE INSERT ON site_publication_requests WHEN NEW.resource_type='sponsorship' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PATCH_FAILURE'); END"
      : "CREATE TRIGGER fail_nonmember_patch BEFORE INSERT ON audit_log WHEN NEW.action='sponsorship_updated' BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PATCH_FAILURE'); END",
  ).run();
  try {
    expect((await patch(f, { nonMemberName: "Changed after retry", tier: "Silver" })).status).toBe(500);
    expect(await state()).toEqual(previous);
    expect((await snapshot(f)).sponsors).toEqual(before);
    expect(await requests()).toEqual([]);
  } finally {
    await env.DB.prepare("DROP TRIGGER fail_nonmember_patch").run();
  }
  expect((await patch(f, { nonMemberName: "Changed after retry", tier: "Silver" })).status).toBe(200);
  expect(await requests()).toHaveLength(1);
  expect((await snapshot(f)).sponsors).not.toEqual(before);
  expect((await patch(f, { nonMemberName: "Changed after retry", tier: "Silver" })).status).toBe(200);
  expect(await requests()).toHaveLength(1);
});
it("rolls back a prepared request when its patch loses the revision CAS", async () => {
  const f = await fixture();
  const raced = mutateBeforeNextBatch(env.DB, () =>
    env.DB.prepare("UPDATE sponsorships SET transition_revision=transition_revision+1 WHERE id=?").bind(f.id).run(),
  );
  await expect(updateSponsorship(raced, actor.id, f.id, { nonMemberName: "Lost patch" })).rejects.toMatchObject({
    code: "SPONSORSHIP_CHANGED",
  });
  expect(await requests()).toEqual([]);
  expect(
    await env.DB.prepare("SELECT non_member_name FROM sponsorships WHERE id=?").bind(f.id).first("non_member_name"),
  ).toBe("Public non-member sponsor");
});
it("rechecks staff authorization before patch and publication commit", async () => {
  const f = await fixture();
  const raced = mutateBeforeNextBatch(env.DB, () =>
    env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(nowIso(), actor.id)
      .run(),
  );
  await expect(
    updateSponsorship(authorizedSponsorshipMutationDb(raced, actor), actor.id, f.id, {
      nonMemberName: "Refused patch",
    }),
  ).rejects.toMatchObject({ code: "SPONSORSHIP_AUTHORIZATION_CHANGED" });
  expect(await requests()).toEqual([]);
  expect(
    await env.DB.prepare("SELECT non_member_name FROM sponsorships WHERE id=?").bind(f.id).first("non_member_name"),
  ).toBe("Public non-member sponsor");
});
it("detects a ranking change caused by a private edit when sponsor id namespaces collide", async () => {
  const f = await fixture("event");
  await env.DB.prepare("UPDATE sponsorships SET updated_at='2020-01-01T00:00:00.000Z' WHERE id=?").bind(f.id).run();
  const at = nowIso();
  await env.DB.prepare(
    "INSERT INTO organizations(id,name,normalized_name,created_at,updated_at) VALUES(?,'Other event sponsor','other event sponsor',?,?)",
  )
    .bind(f.id, at, at)
    .run();
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,renewal_date,created_at,updated_at) VALUES(?,'event',?,?,'Leader','active','2035-12-31',?,'2021-01-01T00:00:00.000Z')",
  )
    .bind(crypto.randomUUID(), f.id, f.eventId, at)
    .run();
  const before = (await snapshot(f)).sponsors;
  expect((await patch(f, { notes: "Touches ranking timestamp" })).status).toBe(200);
  expect((await snapshot(f)).sponsors).not.toEqual(before);
  expect(await requests()).toHaveLength(1);
});
