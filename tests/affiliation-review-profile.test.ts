import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { prepareAffiliationReviewProfileRecovery } from "../functions/_lib/services/identities/affiliation-review-profile";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { resetDb } from "./helpers/reset-db";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser } from "./helpers/membership";

const at = "2026-10-01T00:00:00.000Z";
beforeEach(resetDb);

async function profileFixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const userId = await insertUser(env.DB, "profile@ibm.example");
  const organizationId = await insertOrganization(env.DB, "IBM");
  const target = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    source: "verified_domain",
    startImmediately: true,
    now: at,
  });
  const personal = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId: null,
    source: "account",
    biography: "Personal biography",
    startImmediately: true,
    now: at,
  });
  await env.DB.batch([target.statement, personal.statement]);
  async function review(sourceType: string, title: string | null, organizationName = "IBM") {
    const id = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    if (sourceType === "proposal_speaker") {
      const proposalId = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO session_proposals(id,event_id,proposer_user_id,status,proposal_type,title,abstract,manage_link_secret,submitted_at,updated_at)
          VALUES (?,?,?,'accepted','talk','Example talk','Example abstract',?,?,?)`).bind(
          proposalId,
          eventId,
          userId,
          crypto.randomUUID(),
          at,
          at,
        ),
        env.DB.prepare(`INSERT INTO proposal_speakers(id,proposal_id,user_id,role,status,created_at)
          VALUES (?,?,?,'speaker','confirmed',?)`).bind(sourceId, proposalId, userId, at),
      ]);
    }
    await env.DB.prepare(`INSERT INTO affiliation_reviews(id,user_id,organization_name,normalized_name,job_title,group_key,source_type,source_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(
        id,
        userId,
        organizationName,
        organizationName.toLowerCase(),
        title,
        organizationName.toLowerCase(),
        sourceType,
        sourceId,
        at,
      )
      .run();
    return sourceId;
  }
  async function speakerBio(speakerId: string, biography: string) {
    await env.DB.prepare(`INSERT INTO audit_log(id,actor_type,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,'system','proposal_speaker_profile_override_removed','proposal_speaker',?,?,?)`)
      .bind(crypto.randomUUID(), speakerId, JSON.stringify({ profileOverrides: { from: { biography } } }), at)
      .run();
  }
  async function accountBio(biography: string) {
    await env.DB.prepare(`INSERT INTO audit_log(id,actor_type,action,entity_type,entity_id,details_json,created_at)
      VALUES (?,'system','person_profile_moved_to_identity','user',?,?,?)`)
      .bind(crypto.randomUUID(), userId, JSON.stringify({ biography: { from: biography } }), at)
      .run();
  }
  async function recover() {
    await env.DB.batch(
      prepareAffiliationReviewProfileRecovery(env.DB, { userId, organizationId, identityId: target.identityId, at }),
    );
    return (await queryAll(env.DB, "SELECT job_title,biography FROM identities WHERE id = ?", [target.identityId]))[0];
  }
  return {
    userId,
    identityId: target.identityId,
    personalId: personal.identityId,
    review,
    speakerBio,
    accountBio,
    recover,
  };
}

it("recovers the speaker title and biography ahead of attendee/account details without changing the personal profile", async () => {
  const f = await profileFixture();
  await f.review("user_profile", "Account title");
  await f.review("registration", "Attendee title");
  const speakerId = await f.review("proposal_speaker", "Speaker title");
  await f.accountBio("Attendee biography");
  await f.speakerBio(speakerId, "Speaker biography");
  const unrelated = await f.review("proposal_speaker", "Other title", "Elsewhere");
  await f.speakerBio(unrelated, "Other employer biography");
  expect(await f.recover()).toEqual({ job_title: "Speaker title", biography: "Speaker biography" });
  expect(await queryAll(env.DB, "SELECT biography FROM identities WHERE id = ?", [f.personalId])).toEqual([
    { biography: "Personal biography" },
  ]);
  await f.recover();
  expect(
    await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'identity_profile_recovered' AND entity_id = ?", [
      f.identityId,
    ]),
  ).toHaveLength(1);
});

it("falls back per field and preserves an organization profile that was already edited", async () => {
  const f = await profileFixture();
  await f.review("user_profile", "Account title");
  await f.review("registration", "Attendee title");
  await f.review("proposal_speaker", null);
  await f.accountBio("Attendee biography");
  expect(await f.recover()).toEqual({ job_title: "Attendee title", biography: "Attendee biography" });
  await env.DB.prepare("UPDATE identities SET job_title = 'Edited title', biography = 'Edited biography' WHERE id = ?")
    .bind(f.identityId)
    .run();
  const speaker = await f.review("proposal_speaker", "Later speaker title");
  await f.speakerBio(speaker, "Later speaker biography");
  expect(await f.recover()).toEqual({ job_title: "Edited title", biography: "Edited biography" });
});
