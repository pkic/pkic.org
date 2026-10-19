import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { serializeLinks } from "../assets/shared/schemas/links";
import { runRetentionJob } from "../functions/_lib/services/retention";
import { readSitePublicationSnapshot } from "../functions/_lib/services/site-publication-snapshot";
import { publishedMediaReferences, resolvePublishedMediaKeys } from "../functions/_lib/services/site-publication-media";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { grantGroupLeadershipCapacity } from "./helpers/group-leadership";
import { insertIndividualMember, insertOrgRepresentative } from "./helpers/membership";
import { insertGroupSeat } from "./helpers/person-profile";
import { validPngBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";

let eventId: string;
beforeEach(async () => {
  await resetDb();
  eventId = (await seedEventAndAdmin(env.DB)).eventId;
});
async function registration(userId: string, due = true) {
  const year = due ? "2020" : "2099";
  await env.DB.prepare("UPDATE events SET starts_at=?,ends_at=? WHERE id=?")
    .bind(`${year}-01-01T00:00:00.000Z`, `${year}-01-02T00:00:00.000Z`, eventId)
    .run();
  await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES (?,30,?)")
    .bind(eventId, nowIso())
    .run();
  await env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,source_ref,custom_answers_json,manage_link_secret,created_at,updated_at)
    VALUES (?,?,?,'registered','virtual','direct','Sensitive source','{"private":true}','synthetic-manage',?,?)`)
    .bind(crypto.randomUUID(), eventId, userId, nowIso(), nowIso())
    .run();
}
async function target(state: string, field: string, due = true) {
  const person = await insertOrgRepresentative(env.DB, { email: "retention-group@example.test" });
  await env.DB.prepare("UPDATE users SET first_name=NULL,last_name=NULL,preferred_name=NULL WHERE id=?")
    .bind(person.userId)
    .run();
  await env.DB.prepare(
    "UPDATE identities SET hidden_from_public_profile=1,show_on_organization_profile=0,job_title=NULL,biography=NULL,links_json=NULL WHERE id=?",
  )
    .bind(person.identityId)
    .run();
  if (["name", "all"].includes(field))
    await env.DB.prepare("UPDATE users SET first_name='Retained',last_name='Contributor' WHERE id=?")
      .bind(person.userId)
      .run();
  if (["title", "all"].includes(field))
    await env.DB.prepare("UPDATE identities SET job_title='Retained title' WHERE id=?").bind(person.identityId).run();
  if (["links", "legacy_links", "all"].includes(field))
    await env.DB.prepare("UPDATE identities SET links_json=? WHERE id=?")
      .bind(
        field === "legacy_links"
          ? JSON.stringify({ website: "https://example.test/retained" })
          : serializeLinks(["https://example.test/retained"]),
        person.identityId,
      )
      .run();
  if (field === "bio_only")
    await env.DB.prepare("UPDATE identities SET biography='Private biography' WHERE id=?")
      .bind(person.identityId)
      .run();
  const photoKey = `headshots/${person.userId}/retained.png`;
  if (["photo", "all"].includes(field)) {
    await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(photoKey, person.userId).run();
    await env.SPEAKER_UPLOADS_BUCKET!.put(photoKey, validPngBytes(), { httpMetadata: { contentType: "image/png" } });
  }
  await insertGroupSeat(
    "retention-group",
    { publicRoster: ["roster", "past_roster", "overlap"].includes(state) },
    person,
  );
  const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='retention-group'").first<string>("id");
  await env.DB.prepare("UPDATE groups SET visibility='authenticated' WHERE id=?").bind(groupId).run();
  if (["inherited", "past_leadership"].includes(state)) {
    if (state === "inherited")
      await env.DB.prepare(`INSERT INTO groups(id,type_key,name,slug,parent_group_id,visibility,public_leadership,active,created_at,updated_at)
      VALUES (?,'working_group','Inherited retention group','retention-child',?,'authenticated',1,1,?,?)`)
        .bind(crypto.randomUUID(), groupId, nowIso(), nowIso())
        .run();
    else await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE id=?").bind(groupId).run();
    const role = await grantGroupLeadershipCapacity(env.DB, groupId!, person.userId);
    if (state === "past_leadership")
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?").bind(nowIso(), role.roleAssignmentId).run();
  }
  if (state === "past_roster")
    await env.DB.prepare("UPDATE identities SET ended_at=?,updated_at=? WHERE id=?")
      .bind(nowIso(), nowIso(), person.identityId)
      .run();
  if (state === "overlap") {
    await env.DB.prepare("UPDATE identities SET show_on_organization_profile=1,hidden_from_public_profile=0 WHERE id=?")
      .bind(person.identityId)
      .run();
    await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  } else
    expect(await queryAll(env.DB, "SELECT slug FROM person_profile_slugs WHERE user_id=?", [person.userId])).toEqual(
      [],
    );
  await registration(person.userId, due);
  return { ...person, photoKey };
}
const snapshot = () => readSitePublicationSnapshot(env.DB, []);
const requests = () =>
  queryAll(env.DB, "SELECT id,resource_id,reason_code FROM site_publication_requests ORDER BY sequence");

describe("publication after retention of public group profiles", () => {
  it.each([
    ...["roster", "past_roster", "inherited", "past_leadership"].flatMap((state) =>
      ["name", "title", "links", "legacy_links", "photo"].map((field) => ({ state, field, due: true, changed: true })),
    ),
    { state: "private", field: "name", due: true, changed: false },
    { state: "roster", field: "blank", due: true, changed: false },
    { state: "roster", field: "bio_only", due: true, changed: false },
    { state: "roster", field: "name", due: false, changed: false },
    { state: "overlap", field: "name", due: true, changed: true },
  ])("captures actual retention changes and keeps no-ops quiet: %j", async ({ state, field, due, changed }) => {
    const person = await target(state, field, due);
    const before = await snapshot();
    const count = (await requests()).length;
    await runRetentionJob(env.DB);
    const after = await snapshot();
    if (changed) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    expect(await requests()).toHaveLength(count + Number(changed));
    if (changed)
      expect((await requests()).at(-1)).toMatchObject({
        resource_id: person.userId,
        reason_code: "user_profile_changed",
      });
    if (field === "photo") {
      expect(
        await env.DB.prepare("SELECT headshot_r2_key FROM users WHERE id=?")
          .bind(person.userId)
          .first("headshot_r2_key"),
      ).toBe(person.photoKey);
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(person.photoKey)).not.toBeNull();
      expect(publishedMediaReferences(after).some((reference) => reference.includes(person.identityId))).toBe(false);
    }
    await runRetentionJob(env.DB);
    expect(await snapshot()).toEqual(after);
    expect(await requests()).toHaveLength(count + Number(changed));
  });

  it("publishes removal of a legacy Member-only link with no other public personal fields", async () => {
    const person = await insertIndividualMember(env.DB, "H6", "legacy-retention@example.test");
    await env.DB.prepare("UPDATE users SET first_name=NULL,last_name=NULL,preferred_name=NULL WHERE id=?")
      .bind(person.userId)
      .run();
    await env.DB.prepare("UPDATE identities SET biography=NULL,links_json=? WHERE id=?")
      .bind(JSON.stringify({ website: "https://example.test/legacy-member" }), person.identityId)
      .run();
    await registration(person.userId);
    const before = await snapshot();
    const count = (await requests()).length;
    expect(before.members.find((member) => member.id === person.memberId)?.links).toEqual([
      "https://example.test/legacy-member",
    ]);
    await runRetentionJob(env.DB);
    expect((await snapshot()).members.find((member) => member.id === person.memberId)?.links).toEqual([]);
    expect(await requests()).toHaveLength(count + 1);
    await runRetentionJob(env.DB);
    expect(await requests()).toHaveLength(count + 1);
  });

  it.each(["individual", "representative"])(
    "withholds retained %s portrait metadata and stale media exports",
    async (kind) => {
      const person =
        kind === "individual"
          ? await insertIndividualMember(env.DB, "H6", "retained-portrait@example.test")
          : await insertOrgRepresentative(env.DB, { email: "retained-portrait@example.test" });
      const photoKey = `headshots/${person.userId}/retained.png`;
      await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(photoKey, person.userId).run();
      await env.SPEAKER_UPLOADS_BUCKET!.put(photoKey, validPngBytes(), { httpMetadata: { contentType: "image/png" } });
      await registration(person.userId);
      const before = await snapshot();
      const reference = publishedMediaReferences(before).find((url) =>
        url.includes(kind === "individual" ? person.memberId : person.identityId),
      );
      expect(reference).toBeTruthy();
      expect(Object.values(await resolvePublishedMediaKeys(env.DB, [reference!]))).toContain(photoKey);
      expect((await callApi(env, reference!)).status).toBe(200);
      await runRetentionJob(env.DB);
      expect((await callApi(env, reference!)).status).toBe(404);
      await expect(resolvePublishedMediaKeys(env.DB, [reference!])).rejects.toThrow(
        "A published image reference has no source object",
      );
      const references = publishedMediaReferences(await snapshot());
      expect(references).not.toContain(reference);
      expect(Object.values(await resolvePublishedMediaKeys(env.DB, references))).not.toContain(photoKey);
      expect(
        await env.DB.prepare("SELECT headshot_r2_key FROM users WHERE id=?")
          .bind(person.userId)
          .first("headshot_r2_key"),
      ).toBe(photoKey);
      expect(await env.SPEAKER_UPLOADS_BUCKET!.head(photoKey)).not.toBeNull();
    },
  );

  it.each(["request", "redaction"])("rolls back retention after %s failure and retries", async (failure) => {
    const person = await target("inherited", "all");
    const before = await snapshot();
    const state = async () => ({
      users: await queryAll(
        env.DB,
        "SELECT first_name,last_name,pii_redacted_at,headshot_r2_key,updated_at FROM users WHERE id=?",
        [person.userId],
      ),
      identities: await queryAll(
        env.DB,
        "SELECT job_title,biography,links_json,updated_at FROM identities WHERE user_id=?",
        [person.userId],
      ),
      registrations: await queryAll(
        env.DB,
        "SELECT source_ref,custom_answers_json,updated_at FROM registrations WHERE user_id=?",
        [person.userId],
      ),
      requests: await requests(),
    });
    const persisted = await state();
    await env.DB.prepare(
      failure === "request"
        ? `CREATE TRIGGER fail_group_retention BEFORE INSERT ON site_publication_requests BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_RETENTION_FAILURE'); END`
        : `CREATE TRIGGER fail_group_retention BEFORE UPDATE ON identities WHEN OLD.job_title IS NOT NULL AND NEW.job_title IS NULL BEGIN SELECT RAISE(ABORT,'SYNTHETIC_GROUP_RETENTION_FAILURE'); END`,
    ).run();
    try {
      await expect(runRetentionJob(env.DB)).rejects.toThrow("SYNTHETIC_GROUP_RETENTION_FAILURE");
      expect(await snapshot()).toEqual(before);
      expect(await state()).toEqual(persisted);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_group_retention").run();
    }
    await runRetentionJob(env.DB);
    expect(await snapshot()).not.toEqual(before);
    expect(await requests()).toHaveLength(persisted.requests.length + 1);
    expect(await env.SPEAKER_UPLOADS_BUCKET!.head(person.photoKey)).not.toBeNull();
  });
});
