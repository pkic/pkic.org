import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { resetDb } from "./helpers/reset-db";
import { createMemberSession } from "./helpers/auth";
import { organizationMemberProfileResponseSchema } from "../assets/shared/schemas/organization-self-service";
import {
  addRepresentative,
  assignRepresentativeRole,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
  REPRESENTATIVE_ROLE_IDS,
} from "./helpers/membership";

async function organization() {
  const organizationId = await insertOrganization(env.DB);
  const memberId = await seedOrganizationAggregate(env.DB, organizationId, "F");
  const representatives = await Promise.all(
    ["primary", "secondary", "ordinary"].map(async (role) => {
      const userId = await insertUser(env.DB, `${role}-${organizationId}@example.test`);
      const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: `${role} title` });
      const token = await createMemberSession(env.DB, userId, `${role}-${organizationId}`, undefined, identityId);
      return { userId, identityId, token };
    }),
  );
  return { organizationId, memberId, representatives };
}

async function profile(token: string, organizationId: string) {
  return callApi(
    env,
    new Request(`https://app.test/api/v1/organizations/${organizationId}/profile`, {
      headers: { authorization: `Bearer ${token}` },
    }),
  );
}

async function readProfile(token: string, organizationId: string) {
  const response = await profile(token, organizationId);
  expect(response.status).toBe(200);
  return organizationMemberProfileResponseSchema.parse(await response.json()).organization;
}

beforeEach(resetDb);

describe("organization contact profile", () => {
  it("resolves both confirmed identities and caller roles without treating ordinary representatives as contacts", async () => {
    const org = await organization();
    const [primary, secondary, ordinary] = org.representatives;
    await assignRepresentativeRole(env.DB, org.memberId, primary.userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, org.memberId, secondary.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    for (const [index, representative] of org.representatives.entries()) {
      const data = await readProfile(representative.token, org.organizationId);
      expect(data.primaryContact).toMatchObject({
        id: primary.identityId,
        userId: primary.userId,
        jobTitle: "primary title",
      });
      expect(data.secondaryContact).toMatchObject({
        id: secondary.identityId,
        userId: secondary.userId,
        jobTitle: "secondary title",
      });
      expect(data.isPrimaryContact).toBe(index === 0);
      expect(data.isSecondaryContact).toBe(index === 1);
      expect(data.isOrgContact).toBe(index !== 2);
      expect(data.pendingSecondaryContact).toBeNull();
      expect(data.pendingSecondaryContactUserId).toBeNull();
    }
    const other = await organization();
    expect((await profile(ordinary.token, other.organizationId)).status).toBe(404);
  });

  it("keeps the confirmed holder during a pending replacement and refreshes role changes and vacancies", async () => {
    const org = await organization();
    const [primary, secondary, nominee] = org.representatives;
    await assignRepresentativeRole(env.DB, org.memberId, primary.userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, org.memberId, secondary.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    await env.DB.prepare(`INSERT INTO organization_secondary_contact_nominations
      (id, member_id, nominated_user_id, nominated_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), org.memberId, nominee.userId, primary.userId, "2026-10-17T00:00:00.000Z")
      .run();
    const pending = await readProfile(secondary.token, org.organizationId);
    expect(pending.secondaryContact?.id).toBe(secondary.identityId);
    expect(pending.pendingSecondaryContact?.id).toBe(nominee.identityId);
    await assignRepresentativeRole(env.DB, org.memberId, nominee.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    const changed = await readProfile(secondary.token, org.organizationId);
    expect(changed.secondaryContact?.id).toBe(nominee.identityId);
    expect(changed.isOrgContact).toBe(false);
    await env.DB.prepare("UPDATE user_roles SET revoked_at = ? WHERE context_id = ? AND revoked_at IS NULL")
      .bind("2026-10-17T00:00:00.000Z", org.memberId)
      .run();
    const vacant = await readProfile(primary.token, org.organizationId);
    expect(vacant.primaryContact).toBeNull();
    expect(vacant.secondaryContact).toBeNull();
    expect(vacant.isPrimaryContact).toBe(false);
  });
  it("switches the same person's active identity without leaking another organization's contact assignments", async () => {
    const first = await organization();
    const second = await organization();
    const person = first.representatives[0];
    const secondIdentityId = await addRepresentative(env.DB, second.memberId, person.userId);
    await assignRepresentativeRole(env.DB, first.memberId, person.userId, REPRESENTATIVE_ROLE_IDS.primaryContact);
    await assignRepresentativeRole(env.DB, second.memberId, person.userId, REPRESENTATIVE_ROLE_IDS.secondaryContact);
    expect((await readProfile(person.token, first.organizationId)).isPrimaryContact).toBe(true);
    const switched = await callApi(env, "/api/v1/users/current/identities/active", {
      method: "PUT",
      headers: { authorization: `Bearer ${person.token}`, "content-type": "application/json" },
      body: JSON.stringify({ identityId: secondIdentityId }),
    });
    expect(switched.status).toBe(200);
    const token = switched.headers.get("x-user-token");
    if (!token) throw new Error("The identity switch did not reissue the bearer session");
    const data = await readProfile(token, second.organizationId);
    expect(data.primaryContact).toBeNull();
    expect(data.secondaryContact?.id).toBe(secondIdentityId);
    expect(data.isSecondaryContact).toBe(true);
    expect(data.isPrimaryContact).toBe(false);
    expect((await profile(token, first.organizationId)).status).toBe(404);
  });
});
