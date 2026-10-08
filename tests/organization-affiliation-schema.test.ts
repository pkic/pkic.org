import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";
import { queryAll } from "./helpers/context";
import {
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function addAffiliation(userId: string, organizationId: string | null, emailId?: string | null) {
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    emailId,
    source: "staff",
    startImmediately: true,
  });
  await env.DB.batch([prepared.statement]);
  return prepared.identityId;
}

beforeEach(resetDb);

describe("organization affiliation database invariants", () => {
  it("retains the same organization link when membership is activated later", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const identityId = await addAffiliation(userId, organizationId);
    expect(
      await queryAll(env.DB, "SELECT member_id FROM identity_member_capacities WHERE identity_id=?", [identityId]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [organizationId])).toEqual([]);
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    expect(
      await queryAll(env.DB, "SELECT identity_id,member_id FROM identity_member_capacities WHERE identity_id=?", [
        identityId,
      ]),
    ).toEqual([{ identity_id: identityId, member_id: memberId }]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [userId])).toEqual([{ id: identityId }]);
  });

  it("allows an individual member to hold a nonmember organization affiliation without changing membership", async () => {
    const person = await insertIndividualMember(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const identityId = await addAffiliation(person.userId, organizationId);
    expect(await queryAll(env.DB, "SELECT id,status FROM members WHERE user_id=?", [person.userId])).toEqual([
      { id: person.memberId, status: "active" },
    ]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? ORDER BY id", [person.userId])).toEqual(
      [person.identityId, identityId].sort().map((id) => ({ id })),
    );
    expect(
      await queryAll(env.DB, "SELECT identity_id FROM identity_member_capacities WHERE user_id=?", [person.userId]),
    ).toEqual([{ identity_id: person.identityId }]);
  });

  it("preserves canonical person and organization foreign keys", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    await expect(addAffiliation(crypto.randomUUID(), organizationId)).rejects.toThrow();
    await expect(addAffiliation(userId, crypto.randomUUID())).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [userId])).toEqual([]);
  });

  it("still rejects an individual member identity without an individual membership", async () => {
    const userId = await insertUser(env.DB);
    await expect(addAffiliation(userId, null)).rejects.toThrow("IDENTITY_MEMBER_SCOPE_INVALID");
  });

  it.each([false, true])(
    "rejects a selected alias that is unverified or belongs to another person (other owner: %s)",
    async (otherOwner) => {
      const userId = await insertUser(env.DB);
      const organizationId = await insertOrganization(env.DB);
      const addressUserId = otherOwner ? await insertUser(env.DB) : userId;
      const emailId = crypto.randomUUID();
      const at = nowIso();
      await env.DB.prepare(
        "INSERT INTO user_emails(id,user_id,email,normalized_email,verified_at,created_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          emailId,
          addressUserId,
          "alias@affiliation.example",
          "alias@affiliation.example",
          otherOwner ? at : null,
          at,
        )
        .run();
      await expect(addAffiliation(userId, organizationId, emailId)).rejects.toThrow("IDENTITY_EMAIL_INVALID");
      expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [userId])).toEqual([]);
    },
  );

  it("keeps an existing affiliation's person and organization immutable", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const identityId = await addAffiliation(userId, organizationId);
    const otherUserId = await insertUser(env.DB);
    const otherOrganizationId = await insertOrganization(env.DB);
    await expect(
      env.DB.prepare("UPDATE identities SET user_id=? WHERE id=?").bind(otherUserId, identityId).run(),
    ).rejects.toThrow("IDENTITY_SCOPE_IMMUTABLE");
    await expect(
      env.DB.prepare("UPDATE identities SET organization_id=? WHERE id=?").bind(otherOrganizationId, identityId).run(),
    ).rejects.toThrow("IDENTITY_SCOPE_IMMUTABLE");
  });

  it("keeps ended history and refuses two unresolved identities for the same person and organization", async () => {
    const userId = await insertUser(env.DB);
    const organizationId = await insertOrganization(env.DB);
    const identityId = await addAffiliation(userId, organizationId);
    await expect(addAffiliation(userId, organizationId)).rejects.toMatchObject({ code: "IDENTITY_ALREADY_ACTIVE" });
    const at = nowIso();
    await env.DB.prepare("UPDATE identities SET ended_at=?,updated_at=? WHERE id=?").bind(at, at, identityId).run();
    const successorId = await addAffiliation(userId, organizationId);
    expect(await queryAll(env.DB, "SELECT predecessor_identity_id FROM identities WHERE id=?", [successorId])).toEqual([
      { predecessor_identity_id: identityId },
    ]);
    expect(await queryAll(env.DB, "SELECT ended_at FROM identities WHERE id=?", [identityId])).toEqual([
      { ended_at: at },
    ]);
  });
});
