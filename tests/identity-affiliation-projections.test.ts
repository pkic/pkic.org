import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { identitiesListQuerySchema, identitySourceSchema } from "../assets/shared/schemas/identity";
import { myActiveIdentitySchema } from "../assets/shared/schemas/me";
import { authEligibleIdentitySchema } from "../assets/shared/schemas/member-auth";
import { organizationDetailSchema } from "../assets/shared/schemas/organization-management";
import { userDetailSchema, usersListQuerySchema } from "../assets/shared/schemas/user-management";
import { listOrganizationIdentities, listUserIdentities } from "../functions/_lib/services/identities/read-model";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { getOrganization } from "../functions/_lib/services/organization-management/read-model";
import { getUserDetail } from "../functions/_lib/services/user-management-detail";
import { listUsers } from "../functions/_lib/services/user-management-list";
import { nowIso } from "../functions/_lib/utils/time";
import { seedEventAndAdmin } from "./helpers/context";
import {
  insertIndividualMember,
  insertOrganization,
  insertUser,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

async function affiliation(userId: string, organizationId: string, active = true, emailId: string | null = null) {
  // A staff-authorized relationship fixture exercises the migrated link invariant
  // without making this projection suite depend on domain-link creation policy.
  const prepared = await buildCreateIdentityStatement(env.DB, {
    userId,
    organizationId,
    emailId,
    source: "staff",
    jobTitle: "Engineer",
    startImmediately: active,
  });
  await env.DB.batch([prepared.statement]);
  return prepared.identityId;
}

async function nonmemberFixture() {
  const userId = await insertUser(env.DB, "projection-owner@example.test");
  const organizationId = await insertOrganization(env.DB, "Nonmember Employer");
  const identityId = await affiliation(userId, organizationId);
  return { userId, organizationId, identityId };
}

describe("canonical affiliation read models", () => {
  it("includes owned nonmember affiliations in catalogs, user detail and the organization roster", async () => {
    const f = await nonmemberFixture();
    const otherUserId = await insertUser(env.DB, "projection-other@example.test");
    await affiliation(otherUserId, await insertOrganization(env.DB, "Other Employer"));
    const own = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ active: true }));
    expect(own.page.total).toBe(1);
    expect(own.identities).toHaveLength(1);
    expect(own.identities[0]).toMatchObject({
      id: f.identityId,
      userId: f.userId,
      organizationId: f.organizationId,
      organizationName: "Nonmember Employer",
      memberId: null,
      membershipCategory: null,
      state: "active",
    });
    const roster = await listOrganizationIdentities(env.DB, f.organizationId, identitiesListQuerySchema.parse({}));
    expect(roster.identities.map((identity) => identity.id)).toEqual([f.identityId]);
    const detail = userDetailSchema.parse(await getUserDetail(env.DB, f.userId));
    expect(detail.identities).toHaveLength(1);
    expect(detail.identities[0]).toMatchObject({
      identityId: f.identityId,
      organizationId: f.organizationId,
      organizationName: "Nonmember Employer",
      memberId: null,
      membershipCategory: null,
      status: null,
      jobTitle: "Engineer",
      groups: [],
    });
    const organization = organizationDetailSchema.parse(await getOrganization(env.DB, f.organizationId));
    expect(organization.activeIdentityCount).toBe(1);
    expect(organization.identities).toHaveLength(1);
    expect(organization.identities[0]).toMatchObject({
      identityId: f.identityId,
      membershipId: null,
      isPrimaryContact: false,
      isSecondaryContact: false,
    });
  });

  it("keeps catalog pagination and lifecycle filters consistent without a member aggregate", async () => {
    const f = await nonmemberFixture();
    const pendingId = await affiliation(f.userId, await insertOrganization(env.DB, "Pending Employer"), false);
    const endedId = await affiliation(f.userId, await insertOrganization(env.DB, "Former Employer"));
    await env.DB.prepare("UPDATE identities SET ended_at = ? WHERE id = ?").bind(nowIso(), endedId).run();
    const blockedId = await affiliation(f.userId, await insertOrganization(env.DB, "Blocked Employer"));
    const blockedAt = nowIso();
    await env.DB.prepare("UPDATE identities SET ended_at = ?, blocked_at = ? WHERE id = ?")
      .bind(blockedAt, blockedAt, blockedId)
      .run();
    const active = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ active: true }));
    expect(active.identities.map((identity) => identity.id)).toEqual([f.identityId]);
    expect(active.page.total).toBe(1);
    const inactive = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ active: false }));
    expect(inactive.identities.map((identity) => identity.id).sort()).toEqual([pendingId, endedId, blockedId].sort());
    const first = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ limit: 1 }));
    expect(first.page).toMatchObject({ total: 4, hasMore: true });
    const empty = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ limit: 1, offset: 4 }));
    expect(empty.identities).toEqual([]);
    expect(empty.page).toMatchObject({ total: 4, hasMore: false });
    const detail = userDetailSchema.parse(await getUserDetail(env.DB, f.userId));
    expect(detail.identities.map((identity) => identity.identityId)).toEqual([f.identityId]);
    expect(detail.formerIdentities.map((identity) => identity.identityId).sort()).toEqual([endedId, blockedId].sort());
  });

  it("shows the selected verified secondary address consistently across all affiliation projections", async () => {
    const userId = await insertUser(env.DB, "projection-primary@example.test");
    const organizationId = await insertOrganization(env.DB, "Secondary Mailbox Employer");
    const emailId = crypto.randomUUID();
    const email = "projection-work@employer.example";
    await env.DB.prepare(
      `INSERT INTO user_emails (id, user_id, email, normalized_email, verified_at, verification_method, created_at)
       VALUES (?, ?, ?, ?, datetime('now'), 'magic_link', datetime('now'))`,
    )
      .bind(emailId, userId, email, email)
      .run();
    await affiliation(userId, organizationId, true, emailId);
    const catalog = await listUserIdentities(env.DB, userId, identitiesListQuerySchema.parse({}));
    expect(catalog.identities[0]).toMatchObject({ emailId, email });
    const detail = userDetailSchema.parse(await getUserDetail(env.DB, userId));
    expect(detail.identities[0]).toMatchObject({ emailId, email });
    const organization = organizationDetailSchema.parse(await getOrganization(env.DB, organizationId));
    expect(organization.identities[0]).toMatchObject({ emailId, email });
  });

  it("derives membership for the existing link when the organization becomes a member", async () => {
    const f = await nonmemberFixture();
    const memberId = await seedOrganizationAggregate(env.DB, f.organizationId, "A");
    const own = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ memberId }));
    expect(own.identities).toHaveLength(1);
    expect(own.identities[0]).toMatchObject({ id: f.identityId, memberId, membershipCategory: "A" });
    const nonmemberOrganization = await insertOrganization(env.DB, "Another Nonmember Employer");
    await affiliation(f.userId, nonmemberOrganization);
    const filtered = await listUserIdentities(env.DB, f.userId, identitiesListQuerySchema.parse({ memberId }));
    expect(filtered.identities.map((identity) => identity.id)).toEqual([f.identityId]);
    const detail = userDetailSchema.parse(await getUserDetail(env.DB, f.userId));
    expect(detail.identities.find((identity) => identity.identityId === f.identityId)).toMatchObject({
      memberId,
      membershipCategory: "A",
      status: "active",
    });
    const organization = organizationDetailSchema.parse(await getOrganization(env.DB, f.organizationId));
    expect(organization.identities[0]).toMatchObject({ identityId: f.identityId, membershipId: memberId });
  });

  it("classifies users by active structural membership while preserving nonmember affiliation names", async () => {
    const f = await nonmemberFixture();
    const query = { q: "projection-owner@example.test" };
    const contact = await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "contact_only" }));
    expect(contact.users).toHaveLength(1);
    expect(contact.users[0]).toMatchObject({
      id: f.userId,
      type: "contact_only",
      organizationCount: 1,
      organizationNames: ["Nonmember Employer"],
    });
    expect((await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "member" }))).users).toEqual([]);
    const { eventId } = await seedEventAndAdmin(env.DB);
    await env.DB.prepare(
      `INSERT INTO event_participants (id, event_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'attendee', 'active', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), eventId, f.userId)
      .run();
    const attendee = await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "event_attendee" }));
    expect(attendee.users[0]).toMatchObject({ id: f.userId, type: "event_attendee" });
    const memberId = await seedOrganizationAggregate(env.DB, f.organizationId, "A");
    const member = await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "member" }));
    expect(member.users[0]).toMatchObject({ id: f.userId, type: "member" });
    expect((await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "event_attendee" }))).users).toEqual(
      [],
    );
    await env.DB.prepare("UPDATE members SET status = 'inactive' WHERE id = ?").bind(memberId).run();
    expect((await listUsers(env.DB, usersListQuerySchema.parse({ ...query, type: "member" }))).users).toEqual([]);
    expect((await listUsers(env.DB, usersListQuerySchema.parse(query))).users[0].type).toBe("event_attendee");
    const individual = await insertIndividualMember(env.DB, "H6", "projection-individual@example.test");
    expect(
      (await listUsers(env.DB, usersListQuerySchema.parse({ q: "projection-individual@example.test" }))).users[0],
    ).toMatchObject({ id: individual.userId, type: "member" });
  });

  it("accepts neutral provenance without weakening member-only identity contracts", async () => {
    expect(identitySourceSchema.parse("verified_email")).toBe("verified_email");
    expect(identitySourceSchema.safeParse("typed_name").success).toBe(false);
    const f = await nonmemberFixture();
    const memberShape = {
      identityId: f.identityId,
      memberId: null,
      organizationId: f.organizationId,
      organizationName: "Nonmember Employer",
      membershipCategory: null,
    };
    expect(myActiveIdentitySchema.safeParse(memberShape).success).toBe(false);
    expect(authEligibleIdentitySchema.safeParse(memberShape).success).toBe(false);
  });

  it("filters organization affiliations on the server without changing the owner scope", async () => {
    const individual = await insertIndividualMember(env.DB, "H6", "organization-filter@example.test");
    const organizationId = await insertOrganization(env.DB, "Additional Nonmember Employer");
    const identityId = await affiliation(individual.userId, organizationId);
    const otherUserId = await insertUser(env.DB, "organization-filter-other@example.test");
    await affiliation(otherUserId, organizationId);
    const organizations = await listUserIdentities(
      env.DB,
      individual.userId,
      identitiesListQuerySchema.parse({ organizationOnly: "true", active: true }),
    );
    expect(organizations.identities.map((identity) => identity.id)).toEqual([identityId]);
    expect(organizations.page.total).toBe(1);
    const all = await listUserIdentities(
      env.DB,
      individual.userId,
      identitiesListQuerySchema.parse({ organizationOnly: "false", active: true }),
    );
    expect(all.identities.map((identity) => identity.id).sort()).toEqual([identityId, individual.identityId].sort());
    expect(all.page.total).toBe(2);
  });
});
