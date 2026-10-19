import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedPersonPages } from "../functions/_lib/services/site-session-history";
import { publishedPersonProfile } from "../functions/_lib/services/site-person-profile";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { runRetentionJob } from "../functions/_lib/services/retention";
import { anonymizeUser } from "../functions/_lib/services/user-anonymization";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertIndividualMember } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { resetDb } from "./helpers/reset-db";

let staff: string;
let setup: Awaited<ReturnType<typeof seedEventAndAdmin>>;
beforeEach(async () => {
  await resetDb();
  setup = await seedEventAndAdmin(env.DB);
  staff = await createAdminSession(env.DB, setup.admin.id, "person-lifecycle-admin");
});

async function target(state: string) {
  const person = await insertIndividualMember(env.DB, "H6", "person-lifecycle@example.test");
  if (state !== "unaddressed") {
    await insertGroupSeat("person-lifecycle", { publicRoster: state !== "leadership" }, person);
    if (state === "leadership") {
      await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE slug='person-lifecycle'").run();
      const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='person-lifecycle'").first<string>("id");
      await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
    }
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  }
  if (state !== "active_member" && state !== "leadership")
    await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(person.memberId).run();
  if (["hidden_current_seat", "hidden_past_seat", "blank", "leadership"].includes(state))
    await env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(person.identityId).run();
  if (state === "hidden_past_seat" || state === "blank")
    await env.DB.prepare("UPDATE group_memberships SET left_at=?,updated_at=? WHERE user_id=?")
      .bind(nowIso(), nowIso(), person.userId)
      .run();
  if (state === "ended")
    await env.DB.prepare("UPDATE identities SET ended_at=?,updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), person.identityId)
      .run();
  if (state === "blank")
    await env.DB.prepare("UPDATE users SET first_name=NULL,last_name=NULL,preferred_name=NULL WHERE id=?")
      .bind(person.userId)
      .run();
  await createMemberSession(env.DB, person.userId, "person-lifecycle-owner", undefined, null);
  return person;
}

async function profile(userId: string) {
  const publication = await readSitePublicationSnapshot(env.DB, []);
  const page = publishedPersonPages(publication).find((row) => row.userId === userId);
  return page ? publishedPersonProfile(publication, page) : undefined;
}
const requests = () => queryAll(env.DB, "SELECT id,resource_id FROM site_publication_requests ORDER BY sequence");
function act(userId: string, operation: string) {
  return callApi(env, `/api/v1/users/${userId}${operation === "anonymize" ? "/anonymize" : ""}`, {
    method: operation === "anonymize" ? "POST" : "PATCH",
    headers: { authorization: `Bearer ${staff}`, "content-type": "application/json" },
    ...(operation === "anonymize" ? {} : { body: JSON.stringify({ active: false }) }),
  });
}

async function dueRegistration(userId: string, due = true) {
  const at = nowIso();
  const year = due ? "2020" : "2099";
  await env.DB.batch([
    env.DB.prepare("UPDATE events SET starts_at=?,ends_at=? WHERE id=?").bind(
      `${year}-01-01T00:00:00.000Z`,
      `${year}-01-02T00:00:00.000Z`,
      setup.eventId,
    ),
    env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES (?,30,?)").bind(
      setup.eventId,
      at,
    ),
    env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,source_ref,custom_answers_json,manage_link_secret,created_at,updated_at)
      VALUES (?,?,?,'registered','virtual','direct','Sensitive source','{"sensitive":true}','synthetic-manage',?,?)`).bind(
      crypto.randomUUID(),
      setup.eventId,
      userId,
      at,
      at,
    ),
  ]);
}

describe("publication after person account lifecycle changes", () => {
  it.each(
    ["deactivate", "anonymize"].flatMap((operation) =>
      [
        "visible",
        "hidden_current_seat",
        "hidden_past_seat",
        "ended",
        "unaddressed",
        "active_member",
        "blank",
        "leadership",
      ].map((state) => ({ operation, state })),
    ),
  )("captures changed public person projections: %j", async ({ operation, state }) => {
    const person = await target(state);
    const before = await profile(person.userId);
    const beforeRequests = await requests();
    const response = await act(person.userId, operation);
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await profile(person.userId);
    const changed =
      operation === "anonymize"
        ? state !== "unaddressed"
        : ["visible", "hidden_current_seat", "active_member", "leadership"].includes(state);
    if (changed) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
    expect((await act(person.userId, operation)).status).toBe(operation === "anonymize" ? 409 : 200);
    expect(await requests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
  });

  it.each(
    ["deactivate", "anonymize"].flatMap((operation) => ["request", "audit"].map((failure) => ({ operation, failure }))),
  )("rolls back person account changes and retries: %j", async ({ operation, failure }) => {
    const person = await target("visible");
    const before = await profile(person.userId);
    const beforeRequests = await requests();
    const action = operation === "anonymize" ? "user_anonymized" : "user_updated";
    await env.DB.prepare(`CREATE TRIGGER fail_person_lifecycle BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      WHEN ${failure === "request" ? "NEW.resource_type='user_profile'" : `NEW.action='${action}'`}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_LIFECYCLE_FAILURE'); END`).run();
    try {
      expect((await act(person.userId, operation)).status).toBe(500);
      expect(await profile(person.userId)).toEqual(before);
      expect(await requests()).toEqual(beforeRequests);
      expect(await queryAll(env.DB, "SELECT revoked_at FROM sessions WHERE user_id=?", [person.userId])).toEqual([
        { revoked_at: null },
      ]);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=? AND entity_id=?", [action, person.userId]),
      ).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_person_lifecycle").run();
    }
    const response = await act(person.userId, operation);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await profile(person.userId)).not.toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });

  it("leaves no person erasure request when another account edit wins", async () => {
    const person = await target("visible");
    const beforeRequests = await requests();
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET first_name='Winner',updated_at='2099-01-01T00:00:00.000Z' WHERE id=?")
        .bind(person.userId)
        .run(),
    );
    await expect(anonymizeUser(db, setup.admin, person.userId)).rejects.toMatchObject({
      code: "ANONYMIZATION_CONFLICT",
    });
    expect(await profile(person.userId)).toMatchObject({ name: "Winner" });
    expect(
      await env.DB.prepare("SELECT pii_redacted_at FROM users WHERE id=?").bind(person.userId).first("pii_redacted_at"),
    ).toBeNull();
    expect(await requests()).toEqual(beforeRequests);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='user_anonymized'")).toEqual([]);
  });

  it.each([
    { state: "visible", due: true },
    { state: "blank", due: true },
    { state: "unaddressed", due: true },
    { state: "active_member", due: true },
    { state: "visible", due: false },
  ])("captures retention withdrawal only for due public people: %j", async ({ state, due }) => {
    const person = await target(state);
    await dueRegistration(person.userId, due);
    const before = await profile(person.userId);
    const beforeRequests = await requests();
    await runRetentionJob(env.DB);
    const changed = due && state !== "unaddressed";
    if (changed) expect(await profile(person.userId)).toBeUndefined();
    else expect(await profile(person.userId)).toEqual(before);
    expect(await requests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
    await runRetentionJob(env.DB);
    expect(await requests()).toHaveLength(beforeRequests.length + (changed ? 1 : 0));
  });

  it("rolls back person retention and retries after request failure", async () => {
    const person = await target("visible");
    await dueRegistration(person.userId);
    const before = await profile(person.userId);
    const beforeRequests = await requests();
    await env.DB.prepare(
      "CREATE TRIGGER fail_person_retention BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_RETENTION_FAILURE'); END",
    ).run();
    try {
      await expect(runRetentionJob(env.DB)).rejects.toThrow("SYNTHETIC_PERSON_RETENTION_FAILURE");
      expect(await profile(person.userId)).toEqual(before);
      expect(await requests()).toEqual(beforeRequests);
      expect(
        await env.DB.prepare("SELECT source_ref FROM registrations WHERE user_id=?")
          .bind(person.userId)
          .first("source_ref"),
      ).toBe("Sensitive source");
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_person_retention").run();
    }
    await runRetentionJob(env.DB);
    expect(await profile(person.userId)).toBeUndefined();
    expect(await requests()).toHaveLength(beforeRequests.length + 1);
  });
});
