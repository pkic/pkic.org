import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  organizationMergeCreateSchema,
  organizationMergeResponseSchema,
} from "../assets/shared/schemas/organization-merge";
import { organizationsListResponseSchema } from "../assets/shared/schemas/organization-management";
import { linkVerifiedAddressToDomainOrganization } from "../functions/_lib/services/identities/email-domain-link";
import { getPublicMemberById } from "../functions/_lib/services/membership/directory";
import { readMergedOrganizationPageRedirects } from "../functions/_lib/services/organization-management/merge";
import { issueContributorProfileAddresses } from "../functions/_lib/services/people/profile-addresses";
import { insertGroupSeat, readPublicPersonProfile } from "./helpers/person-profile";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession, createMemberSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

async function claimDomain(organizationId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims (id, domain, organization_id, application_id, created_at, updated_at)
     VALUES (?, ?, ?, NULL, ?, ?)`,
  )
    .bind(crypto.randomUUID(), domain, organizationId, nowIso(), nowIso())
    .run();
}

async function representative(
  organizationId: string,
  email: string,
  options: { isDefault?: boolean; pending?: boolean } = {},
): Promise<{ userId: string; identityId: string }> {
  const userId = await insertUser(env.DB, email);
  const identityId = crypto.randomUUID();
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    ).bind(at, userId),
    env.DB.prepare(
      `INSERT INTO identities (id, user_id, organization_id, job_title, source, is_default, invited_at, started_at,
         created_at, updated_at)
       VALUES (?, ?, ?, 'Engineer', 'verified_domain', ?, ?, ?, ?, ?)`,
    ).bind(identityId, userId, organizationId, options.isDefault ? 1 : 0, at, options.pending ? null : at, at, at),
  ]);
  return { userId, identityId };
}

async function addIdentity(userId: string, organizationId: string): Promise<string> {
  const id = crypto.randomUUID();
  const at = nowIso();
  await env.DB.prepare(
    `INSERT INTO identities (id, user_id, organization_id, source, invited_at, started_at, created_at, updated_at)
     VALUES (?, ?, ?, 'staff', ?, ?, ?, ?)`,
  )
    .bind(id, userId, organizationId, at, at, at, at)
    .run();
  return id;
}

async function addressedMergeRepresentative(organizationId: string, hidden: boolean, blocked = false) {
  const person = await representative(organizationId, "merge-visibility@example.test", { isDefault: true });
  const other = await insertOrganization(env.DB, "Public Merge Group Organization");
  const memberId = await seedOrganizationAggregate(env.DB, other, "A");
  const otherIdentity = await addIdentity(person.userId, other);
  await insertGroupSeat(
    "merge-profile-visibility",
    { publicRoster: true },
    { userId: person.userId, identityId: otherIdentity, memberId },
  );
  await issueContributorProfileAddresses(env.DB, nowIso(), 50);
  await env.DB.batch([
    env.DB.prepare("UPDATE identities SET hidden_from_public_profile=1 WHERE id=?").bind(otherIdentity),
    env.DB.prepare(
      "UPDATE identities SET hidden_from_public_profile=?,biography='Continuation biography' WHERE id=?",
    ).bind(hidden ? 1 : 0, person.identityId),
    ...(blocked
      ? [
          env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=? WHERE id=?").bind(
            nowIso(),
            nowIso(),
            person.identityId,
          ),
        ]
      : []),
  ]);
  return person;
}

describe("merging a duplicate organization", () => {
  let token: string;
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1"))[0]
      .id;
    token = await createAdminSession(env.DB, adminId, "organization-merge-admin-token");
  });

  function merge(targetId: string, body: unknown, bearer = token) {
    return callApi(env, `/api/v1/organizations/${targetId}/merges`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it.each([false, true])(
    "preserves staff-hidden visibility when a merge continues an identity (hidden=%s)",
    async (hidden) => {
      const target = await insertOrganization(env.DB, "Merge Visibility Target");
      const source = await insertOrganization(env.DB, "Merge Visibility Source");
      const person = await addressedMergeRepresentative(source, hidden);
      const response = await merge(target, { sourceOrganizationId: source });
      expect(response.status, await response.clone().text()).toBe(201);
      const [successor] = await queryAll<{ id: string; hidden_from_public_profile: number }>(
        env.DB,
        "SELECT id,hidden_from_public_profile FROM identities WHERE predecessor_identity_id=? AND organization_id=?",
        [person.identityId, target],
      );
      expect(
        (await readPublicPersonProfile(person.userId))?.identities.some((identity) => identity.id === successor.id),
      ).toBe(!hidden);
      expect(successor.hidden_from_public_profile).toBe(hidden ? 1 : 0);
    },
  );

  it("preserves staff-hidden visibility when a merge carries a blocked identity", async () => {
    const target = await insertOrganization(env.DB, "Blocked Visibility Target");
    const source = await insertOrganization(env.DB, "Blocked Visibility Source");
    const person = await addressedMergeRepresentative(source, true, true);
    const before = await readPublicPersonProfile(person.userId);
    const response = await merge(target, { sourceOrganizationId: source });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      await queryAll(
        env.DB,
        "SELECT hidden_from_public_profile,blocked_at IS NOT NULL AS blocked FROM identities WHERE predecessor_identity_id=? AND organization_id=?",
        [person.identityId, target],
      ),
    ).toEqual([{ hidden_from_public_profile: 1, blocked: 1 }]);
    expect(await readPublicPersonProfile(person.userId)).toEqual(before);
  });

  it.each([
    "active",
    "ended",
    "ancestor",
    "hidden",
    "pending",
    "blocked",
    "unaddressed",
    "same-brand",
    "logo",
    "ancestor-same-brand",
    "member",
  ])("publishes changed person-only merge projections: %s", async (state) => {
    const target = await insertOrganization(env.DB, "Person Merge Target");
    const source = await insertOrganization(env.DB, "Person Merge Source");
    const origin = state.startsWith("ancestor") ? await insertOrganization(env.DB, "Earlier Merge Source") : source;
    if (state.startsWith("ancestor"))
      await env.DB.prepare("UPDATE organizations SET merged_into_organization_id=? WHERE id=?")
        .bind(source, origin)
        .run();
    const person = await addressedMergeRepresentative(origin, state === "hidden", state === "blocked");
    if (["ended", "ancestor", "same-brand", "ancestor-same-brand", "logo"].includes(state))
      await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), person.identityId).run();
    if (["same-brand", "ancestor-same-brand", "logo"].includes(state))
      await env.DB.prepare("UPDATE organizations SET name='Person Merge Source' WHERE id=?").bind(target).run();
    if (state === "logo")
      await env.DB.prepare("UPDATE organizations SET logo_r2_key='synthetic-merge-logo' WHERE id=?").bind(target).run();
    if (state === "member") {
      await seedOrganizationAggregate(env.DB, source, "A");
      await seedOrganizationAggregate(env.DB, target, "A");
    }
    if (state === "pending")
      await env.DB.prepare("UPDATE identities SET started_at=NULL WHERE id=?").bind(person.identityId).run();
    if (state === "unaddressed")
      await env.DB.prepare("DELETE FROM person_profile_slugs WHERE user_id=?").bind(person.userId).run();
    const before = await readPublicPersonProfile(person.userId);
    const response = await merge(target, {
      sourceOrganizationId: source,
      ...(state === "member" ? { endSourceMembership: true } : {}),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const changed = ["active", "ended", "ancestor", "logo", "member"].includes(state);
    if (changed) expect(await readPublicPersonProfile(person.userId)).not.toEqual(before);
    else expect(await readPublicPersonProfile(person.userId)).toEqual(before);
    expect(
      await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests WHERE resource_id=?", [target]),
    ).toEqual(changed ? [{ resource_id: target }] : []);
  });

  it.each(["private", "seat", "leadership"])(
    "publishes hidden-identity group terms only when public: %s",
    async (kind) => {
      const publicTerm = kind !== "private";
      const target = await insertOrganization(env.DB, "Group Merge Target");
      const source = await insertOrganization(env.DB, "Group Merge Source");
      const person = await addressedMergeRepresentative(source, true);
      const memberId = await seedOrganizationAggregate(env.DB, source, "A");
      await insertGroupSeat(
        "merge-ended-term",
        { publicRoster: kind === "seat" },
        { userId: person.userId, identityId: person.identityId, memberId },
      );
      if (kind === "leadership") {
        await env.DB.prepare("UPDATE groups SET public_leadership=1 WHERE slug='merge-ended-term'").run();
        const groupId = await env.DB.prepare("SELECT id FROM groups WHERE slug='merge-ended-term'").first<string>("id");
        await env.DB.prepare(`INSERT INTO user_roles
          (id,user_id,member_id,identity_id,role_id,context_type,context_id,single_holder_per_context,created_at)
          VALUES (?,?,?,?,'role-group_lead','group',?,0,?)`)
          .bind(crypto.randomUUID(), person.userId, memberId, person.identityId, groupId, nowIso())
          .run();
      }
      // An unreconciled seat can outlive an inactive membership; the merge must still publish its closure.
      await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
      const before = await readPublicPersonProfile(person.userId);
      const response = await merge(target, { sourceOrganizationId: source });
      expect(response.status, await response.clone().text()).toBe(201);
      if (publicTerm) expect(await readPublicPersonProfile(person.userId)).not.toEqual(before);
      else expect(await readPublicPersonProfile(person.userId)).toEqual(before);
      expect(
        await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests WHERE resource_id=?", [target]),
      ).toEqual(publicTerm ? [{ resource_id: target }] : []);
    },
  );

  it.each(["request", "audit"])("rolls back a person-only merge after %s failure and retries", async (failure) => {
    const target = await insertOrganization(env.DB, "Rollback Person Target");
    const source = await insertOrganization(env.DB, "Rollback Person Source");
    const person = await addressedMergeRepresentative(source, false);
    const before = await readPublicPersonProfile(person.userId);
    await env.DB.prepare(`CREATE TRIGGER fail_person_merge BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      ${failure === "audit" ? "WHEN NEW.action='organization_merged'" : ""}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_PERSON_MERGE_FAILURE'); END`).run();
    try {
      expect((await merge(target, { sourceOrganizationId: source })).status).toBe(500);
      expect(await readPublicPersonProfile(person.userId)).toEqual(before);
      expect(
        await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests WHERE resource_id=?", [target]),
      ).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='organization_merged'")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_person_merge").run();
    }
    const response = await merge(target, { sourceOrganizationId: source });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await readPublicPersonProfile(person.userId)).not.toEqual(before);
    expect(
      await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests WHERE resource_id=?", [target]),
    ).toEqual([{ resource_id: target }]);
  });

  it("moves people, domains and sponsorships to the organization that stays and records the merge", async () => {
    const ibm = await insertOrganization(env.DB, "IBM");
    const ibmNl = await insertOrganization(env.DB, "IBM Netherlands");
    await claimDomain(ibm, "ibm.de");
    await claimDomain(ibmNl, "ibm.nl");
    const moved = await representative(ibmNl, "jan@ibm.nl", { isDefault: true });
    const both = await representative(ibmNl, "eva@ibm.nl", { isDefault: true });
    const kept = await addIdentity(both.userId, ibm);
    const invited = await representative(ibmNl, "piet@ibm.nl", { pending: true });
    await env.DB.prepare(
      `INSERT INTO sponsorships (id, sponsor_type, organization_id, created_at, updated_at)
       VALUES ('sponsorship-nl', 'consortium', ?, datetime('now'), datetime('now'))`,
    )
      .bind(ibmNl)
      .run();

    const response = await merge(ibm, organizationMergeCreateSchema.parse({ sourceOrganizationId: ibmNl }));
    expect(response.status, await response.clone().text()).toBe(201);
    expect(organizationMergeResponseSchema.parse(await response.json()).merge).toEqual({
      organizationId: ibm,
      sourceOrganizationId: ibmNl,
      identitiesMoved: 1,
      identitiesEnded: 1,
      invitationsCancelled: 1,
      domainsMoved: ["ibm.nl"],
      sponsorshipsMoved: 1,
      sourceMembershipEnded: false,
    });

    expect(
      await queryAll(
        env.DB,
        `SELECT user_id, organization_id, predecessor_identity_id, job_title, is_default FROM identities
          WHERE started_at IS NOT NULL AND ended_at IS NULL ORDER BY user_id`,
      ),
    ).toEqual(
      [
        {
          user_id: moved.userId,
          organization_id: ibm,
          predecessor_identity_id: moved.identityId,
          job_title: "Engineer",
          is_default: 1,
        },
        { user_id: both.userId, organization_id: ibm, predecessor_identity_id: null, job_title: null, is_default: 1 },
      ].sort((left, right) => left.user_id.localeCompare(right.user_id)),
    );
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE id = ? AND is_default = 1", [kept])).toHaveLength(1);
    expect(
      await queryAll(env.DB, "SELECT ended_at IS NOT NULL AS ended FROM identities WHERE id = ?", [invited.identityId]),
    ).toEqual([{ ended: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT domain FROM organization_domain_claims WHERE organization_id = ? ORDER BY domain",
        [ibm],
      ),
    ).toEqual([{ domain: "ibm.de" }, { domain: "ibm.nl" }]);
    expect(await queryAll(env.DB, "SELECT organization_id FROM sponsorships WHERE id = 'sponsorship-nl'")).toEqual([
      { organization_id: ibm },
    ]);
    expect(
      await queryAll(env.DB, "SELECT merged_into_organization_id FROM organizations WHERE id = ?", [ibmNl]),
    ).toEqual([{ merged_into_organization_id: ibm }]);
    expect(
      await queryAll(
        env.DB,
        `SELECT action, actor_id, json_extract(details_json, '$.organizationId.from') AS from_id,
                json_extract(details_json, '$.organizationId.to') AS to_id
           FROM audit_log WHERE action IN ('organization_merged', 'organization_merged_into') ORDER BY action`,
      ),
    ).toEqual([
      { action: "organization_merged", actor_id: adminId, from_id: ibmNl, to_id: ibm },
      { action: "organization_merged_into", actor_id: adminId, from_id: ibmNl, to_id: ibm },
    ]);

    // The directory lists one organization, and a colleague on either domain now joins it.
    const listed = await callApi(env, "/api/v1/organizations?q=IBM", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(organizationsListResponseSchema.parse(await listed.json()).organizations.map((org) => org.name)).toEqual([
      "IBM",
    ]);
    const colleague = await insertUser(env.DB, "kees@ibm.nl");
    await env.DB.prepare(
      "UPDATE users SET email_verified_at = ?, email_verification_method = 'magic_link' WHERE id = ?",
    )
      .bind(nowIso(), colleague)
      .run();
    expect(
      await linkVerifiedAddressToDomainOrganization(env.DB, { userId: colleague, normalizedEmail: "kees@ibm.nl" }),
    ).toMatchObject({ organizationId: ibm });
  });

  it("refuses to move a membership: merge the other way, or confirm the source's membership ends", async () => {
    const member = await insertOrganization(env.DB, "Member Org");
    await seedOrganizationAggregate(env.DB, member, "A");
    const plain = await insertOrganization(env.DB, "Plain Org");

    const wrongWay = await merge(plain, { sourceOrganizationId: member });
    expect(wrongWay.status).toBe(409);
    expect(await wrongWay.text()).toContain("ORGANIZATION_MERGE_SOURCE_IS_MEMBER");

    const otherMember = await insertOrganization(env.DB, "Other Member Org");
    await seedOrganizationAggregate(env.DB, otherMember, "A");
    const unconfirmed = await merge(member, { sourceOrganizationId: otherMember });
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.text()).toContain("ORGANIZATION_MERGE_CONFIRMATION_REQUIRED");
    expect(
      await queryAll(env.DB, "SELECT merged_into_organization_id FROM organizations WHERE id = ?", [otherMember]),
    ).toEqual([{ merged_into_organization_id: null }]);

    const confirmed = await merge(member, { sourceOrganizationId: otherMember, endSourceMembership: true });
    expect(confirmed.status, await confirmed.clone().text()).toBe(201);
    expect(organizationMergeResponseSchema.parse(await confirmed.json()).merge.sourceMembershipEnded).toBe(true);
    expect(await queryAll(env.DB, "SELECT status FROM members WHERE organization_id = ?", [otherMember])).toEqual([
      { status: "inactive" },
    ]);
    expect((await merge(member, { sourceOrganizationId: otherMember, endSourceMembership: true })).status).toBe(409);
    expect((await merge(member, { sourceOrganizationId: member })).status).toBe(422);
  });

  it.each([false, true])("publishes only a changed public redirect (slugs=%s)", async (publicSlugs) => {
    const target = await insertOrganization(env.DB, "Target");
    const source = await insertOrganization(env.DB, "Source");
    if (publicSlugs) {
      await env.DB.batch([
        env.DB.prepare("UPDATE organizations SET slug='merge-target' WHERE id=?").bind(target),
        env.DB.prepare("UPDATE organizations SET slug='merge-source' WHERE id=?").bind(source),
      ]);
    }
    expect(await readMergedOrganizationPageRedirects(env.DB)).toEqual([]);
    const response = await merge(target, { sourceOrganizationId: source });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await readMergedOrganizationPageRedirects(env.DB)).toEqual(
      publicSlugs ? [{ fromSlug: "merge-source", toSlug: "merge-target" }] : [],
    );
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual(
      publicSlugs ? [{ resource_id: target, reason_code: "organization_content_changed" }] : [],
    );
    expect((await merge(target, { sourceOrganizationId: source })).status).toBe(409);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(publicSlugs ? 1 : 0);
  });

  it.each([
    { visible: true, existing: false, changed: true },
    { visible: false, existing: false, changed: false },
    { visible: true, existing: true, changed: false },
  ])("publishes a roster addition only when the public profile changes: %j", async ({ visible, existing, changed }) => {
    const target = await insertOrganization(env.DB, "Target");
    const source = await insertOrganization(env.DB, "Source");
    await seedOrganizationAggregate(env.DB, target, "A");
    const person = await representative(source, "merge-roster@example.test");
    await env.DB.prepare("UPDATE identities SET show_on_organization_profile=? WHERE id=?")
      .bind(visible ? 1 : 0, person.identityId)
      .run();
    if (existing) await addIdentity(person.userId, target);
    const before = await getPublicMemberById(env.DB, target);
    expect(before).not.toBeNull();
    const response = await merge(target, { sourceOrganizationId: source });
    expect(response.status, await response.clone().text()).toBe(201);
    const after = await getPublicMemberById(env.DB, target);
    if (changed) expect(after).not.toEqual(before);
    else expect(after).toEqual(before);
    expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual(
      changed ? [{ resource_id: target }] : [],
    );
  });

  it.each(["active", "new_inquiry"])("publishes moved event sponsorships only when public: %s", async (stage) => {
    const target = await insertOrganization(env.DB, "Target Sponsor");
    const source = await insertOrganization(env.DB, "Source Sponsor");
    const [{ id: eventId }] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug='pqc-2026'");
    const at = nowIso();
    await env.DB.prepare(`INSERT INTO sponsorships(id,sponsor_type,organization_id,event_id,tier,pipeline_stage,created_at,updated_at)
      VALUES (?,'event',?,?,'Leader',?,?,?)`)
      .bind(crypto.randomUUID(), source, eventId, stage, at, at)
      .run();
    const readSponsors = async () => {
      const response = await callApi(env, "/api/v1/sponsors?eventSlug=pqc-2026");
      expect(response.status).toBe(200);
      return ((await response.json()) as { sponsors: Array<{ name: string }> }).sponsors;
    };
    expect(await readSponsors()).toEqual(
      stage === "active" ? [expect.objectContaining({ name: "Source Sponsor" })] : [],
    );
    const response = await merge(target, { sourceOrganizationId: source });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await readSponsors()).toEqual(
      stage === "active" ? [expect.objectContaining({ name: "Target Sponsor" })] : [],
    );
    expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual(
      stage === "active" ? [{ resource_id: target }] : [],
    );
  });

  it.each(["request", "audit"])("rolls back a public merge after %s failure and allows retry", async (failure) => {
    const target = await insertOrganization(env.DB, "Target");
    const source = await insertOrganization(env.DB, "Source");
    await seedOrganizationAggregate(env.DB, target, "A");
    await seedOrganizationAggregate(env.DB, source, "A");
    const person = await representative(source, "merge-rollback@example.test");
    await env.DB.prepare(`CREATE TRIGGER fail_merge BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
      ${failure === "audit" ? "WHEN NEW.action='organization_merged'" : ""}
      BEGIN SELECT RAISE(ABORT,'SYNTHETIC_MERGE_FAILURE'); END`).run();
    try {
      expect((await merge(target, { sourceOrganizationId: source, endSourceMembership: true })).status).toBe(500);
      expect(
        await queryAll(env.DB, "SELECT merged_into_organization_id FROM organizations WHERE id=?", [source]),
      ).toEqual([{ merged_into_organization_id: null }]);
      expect(await queryAll(env.DB, "SELECT ended_at FROM identities WHERE id=?", [person.identityId])).toEqual([
        { ended_at: null },
      ]);
      expect(await queryAll(env.DB, "SELECT status FROM members WHERE organization_id=?", [source])).toEqual([
        { status: "active" },
      ]);
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log WHERE action='organization_merged'")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_merge").run();
    }
    const response = await merge(target, { sourceOrganizationId: source, endSourceMembership: true });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual([
      { resource_id: target },
    ]);
  });

  it("refuses a caller without the organization and membership write permissions", async () => {
    const target = await insertOrganization(env.DB, "Target Org");
    const source = await insertOrganization(env.DB, "Source Org");
    const person = await insertUser(env.DB, "plain@example.test");
    const memberToken = await createMemberSession(env.DB, person, "organization-merge-member-token");
    const response = await merge(target, { sourceOrganizationId: source }, memberToken);
    expect([401, 403]).toContain(response.status);
    expect(
      await queryAll(env.DB, "SELECT merged_into_organization_id FROM organizations WHERE id = ?", [source]),
    ).toEqual([{ merged_into_organization_id: null }]);
  });
});
