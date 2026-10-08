import { ADMINISTRATOR_FIXTURE_USER_SQL, grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  prepareExplicitVerifiedDomainIdentityStatements,
  prepareVerifiedOrganizationAffiliation,
} from "../functions/_lib/services/identities";
import { buildCreateIdentityStatement } from "../functions/_lib/services/membership/identities";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { deliveredEmailPayload, queryAll } from "./helpers/context";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { insertOrganization, insertUser, seedOrganizationAggregate } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import {
  requiredMembershipApplicationAnswers,
  seedMemberApplication,
  seedMembershipApplicationForm,
  verifiedMemberApplicationPayload,
} from "./helpers/member-applications";
import {
  issueMemberJoinApplicationToken,
  newMemberJoinCapabilityPayload,
} from "../functions/_lib/services/membership/join/capabilities";
import { buildFindOrCreateUserStatement } from "../functions/_lib/services/users";
import { buildProvisionOrganizationMembership } from "../functions/_lib/services/membership/provisioning";
import { prepareVerifyOwnedEmailStatements } from "../functions/_lib/services/email-verification";

async function verifiedPerson() {
  const email = "speaker@affiliation-work.example";
  const userId = await insertUser(env.DB, email);
  await env.DB.prepare("UPDATE users SET email_verified_at=?,email_verification_method='magic_link' WHERE id=?")
    .bind(nowIso(), userId)
    .run();
  const token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(userId).first<string>("id");
  return { userId, email, token, sessionId: sessionId! };
}

function proofEvidence(person: { userId: string; sessionId: string }) {
  return {
    sql: `SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL
    AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    bindings: [person.sessionId, person.userId],
  };
}

async function claimDomain(organizationId: string) {
  await env.DB.prepare(
    `INSERT INTO organization_domain_claims
    (id,domain,organization_id,application_id,created_at,updated_at) VALUES (?,'affiliation-work.example',?,NULL,?,?)`,
  )
    .bind(crypto.randomUUID(), organizationId, nowIso(), nowIso())
    .run();
}

async function request(path: string, token: string, method: string, body?: unknown) {
  return callApi(env, path, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function staffToken() {
  const userId = await insertUser(env.DB, "affiliation-staff@example.test");
  await grantAdministrator(env.DB, userId);
  return createAdminSession(env.DB, userId, crypto.randomUUID());
}

async function prepare(
  person: Awaited<ReturnType<typeof verifiedPerson>>,
  organization: { organizationId?: string; organizationName?: string },
) {
  return prepareVerifiedOrganizationAffiliation(env.DB, {
    userId: person.userId,
    normalizedEmail: person.email,
    emailId: null,
    at: nowIso(),
    proofEvidence: proofEvidence(person),
    ...organization,
  });
}

beforeEach(resetDb);

describe("canonical organization affiliations", () => {
  it("activates an exact completed domain affiliation without requiring an organization membership", async () => {
    const person = await verifiedPerson();
    const organizationId = await insertOrganization(env.DB, "A nonmember organization");
    await claimDomain(organizationId);
    // An independent existing affiliation legitimately admits this canonical human session.
    const priorOrganization = await insertOrganization(env.DB, "Existing Human Affiliation");
    const priorIdentity = await buildCreateIdentityStatement(env.DB, {
      userId: person.userId,
      organizationId: priorOrganization,
      source: "staff",
      startImmediately: true,
    });
    await env.DB.batch([priorIdentity.statement]);
    const response = await request("/api/v1/users/current/identities", person.token, "POST", {
      organizationId,
      emailId: null,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const identity = (await response.json()) as { identityId: string };
    const listed = await request(
      `/api/v1/users/current/identities?organizationId=${organizationId}`,
      person.token,
      "GET",
    );
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(await listed.json()).toMatchObject({
      identities: [
        { id: identity.identityId, organizationId, memberId: null, membershipCategory: null, state: "active" },
      ],
    });
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [organizationId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id=?", [person.userId])).toEqual([]);
    expect((await request(`/api/v1/organizations/${organizationId}/identities`, person.token, "GET")).status).toBe(403);
    const repeated = await request("/api/v1/users/current/identities", person.token, "POST", {
      organizationId,
      emailId: null,
    });
    expect(repeated.status, await repeated.clone().text()).toBe(201);
    expect(await repeated.json()).toMatchObject({ identityId: identity.identityId });
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND organization_id=?", [
        person.userId,
        organizationId,
      ]),
    ).toHaveLength(1);
  });

  it("creates a new canonical nonmember organization after proof and derives membership when that organization becomes a member", async () => {
    const person = await verifiedPerson();
    await env.DB.prepare(
      "UPDATE users SET email='known-affiliated-person@gmail.com',normalized_email='known-affiliated-person@gmail.com' WHERE id=?",
    )
      .bind(person.userId)
      .run();
    const emailId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,?,?)",
    )
      .bind(emailId, person.userId, person.email, person.email, nowIso(), nowIso())
      .run();
    const prepared = await prepareVerifiedOrganizationAffiliation(env.DB, {
      userId: person.userId,
      normalizedEmail: person.email,
      emailId,
      organizationName: "New Affiliation Organization",
      at: nowIso(),
      proofEvidence: proofEvidence(person),
      profile: { jobTitle: "Engineer", biography: "Speaker biography", linksJson: '["https://example.test/speaker"]' },
    });
    expect(prepared.memberId).toBeNull();
    expect(prepared.snapshot).toEqual({
      organizationName: "New Affiliation Organization",
      jobTitle: "Engineer",
      biography: "Speaker biography",
      links: ["https://example.test/speaker"],
    });
    await env.DB.batch(prepared.statements);
    expect(await queryAll(env.DB, "SELECT id FROM organization_domain_claims")).toEqual([]);
    expect(
      await queryAll(env.DB, "SELECT source,email_id,job_title FROM identities WHERE id=?", [prepared.identityId]),
    ).toEqual([{ source: "verified_email", email_id: emailId, job_title: "Engineer" }]);
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [prepared.organizationId])).toEqual(
      [],
    );
    expect(
      await queryAll(
        env.DB,
        "SELECT scope_type,scope_id FROM audit_log WHERE entity_id=? AND action='organization_identity_activated'",
        [prepared.identityId],
      ),
    ).toEqual([{ scope_type: "user", scope_id: person.userId }]);

    const beforeIdentity = await queryAll(
      env.DB,
      "SELECT email_id,job_title,biography,links_json,source,updated_at FROM identities WHERE id=?",
      [prepared.identityId],
    );
    await seedMembershipApplicationForm();
    const application = await verifiedMemberApplicationPayload({
      applicantEmail: person.email,
      applicantName: "Different Submitted Name",
      organizationName: "New Affiliation Organization",
      membershipCategory: "A",
      answers: {
        reason: "Apply after the speaking affiliation",
        job_title: "Different submitted position",
        linkedin: "https://example.test/application",
        ...requiredMembershipApplicationAnswers,
      },
    });
    application.joinToken = await issueMemberJoinApplicationToken(
      env.INTERNAL_SIGNING_SECRET!,
      {
        ...newMemberJoinCapabilityPayload(person.email, "organization"),
        applicantUserId: person.userId,
      },
      15 * 60,
    );
    const submitted = await callApi(env, "/api/v1/members/applications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(application),
    });
    expect(submitted.status, await submitted.clone().text()).toBe(201);
    const applicationReceipt = (await submitted.json()) as { applicationId: string };
    // Supply completed review evidence for the workflow the real submission pinned.
    await env.DB.prepare(
      `UPDATE membership_application_steps SET state='complete',completed_at=?,
       completion_reason='Completed review fixture for canonical affiliation reuse' WHERE application_id=?`,
    )
      .bind(nowIso(), applicationReceipt.applicationId)
      .run();
    const approval = await request(
      `/api/v1/members/applications/${applicationReceipt.applicationId}/approve`,
      await staffToken(),
      "POST",
    );
    expect(approval.status, await approval.clone().text()).toBe(200);
    const approved = (await approval.json()) as { memberId: string; userId: string; organizationId: string };
    expect(approved).toMatchObject({ organizationId: prepared.organizationId, userId: person.userId });
    expect(
      await queryAll(env.DB, "SELECT member_id FROM identity_member_capacities WHERE identity_id=?", [
        prepared.identityId,
      ]),
    ).toEqual([{ member_id: approved.memberId }]);
    expect(
      await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=? AND organization_id=?", [
        person.userId,
        prepared.organizationId,
      ]),
    ).toEqual([{ id: prepared.identityId }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT email_id,job_title,biography,links_json,source,updated_at FROM identities WHERE id=?",
        [prepared.identityId],
      ),
    ).toEqual(beforeIdentity);
    expect(
      await queryAll(
        env.DB,
        "SELECT organization_id,application_id FROM organization_domain_claims WHERE domain='affiliation-work.example'",
      ),
    ).toEqual([{ organization_id: prepared.organizationId, application_id: null }]);
    expect(
      await queryAll(env.DB, "SELECT stage,applicant_user_id FROM member_applications WHERE id=?", [
        applicationReceipt.applicationId,
      ]),
    ).toEqual([{ stage: "approved", applicant_user_id: person.userId }]);
  });

  it("rolls back membership provisioning when a reused canonical affiliation profile changes before commit", async () => {
    const person = await verifiedPerson();
    const affiliation = await prepare(person, { organizationName: "Reviewed Existing Affiliation" });
    await env.DB.batch(affiliation.statements);
    const provision = await buildProvisionOrganizationMembership(env.DB, {
      organizationName: "Reviewed Existing Affiliation",
      membershipCategory: "A",
      identities: [{ name: "Submitted name", email: person.email }],
      identitySource: "membership_approval",
      activateIdentities: true,
      workingGroupSlugs: [],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE identities SET job_title='Concurrent approved update' WHERE id=?")
        .bind(affiliation.identityId)
        .run(),
    );
    await expect(racedDb.batch(provision.statements)).rejects.toThrow();
    expect(
      await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [affiliation.organizationId]),
    ).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM user_roles WHERE user_id=?", [person.userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT job_title FROM identities WHERE id=?", [affiliation.identityId])).toEqual([
      { job_title: "Concurrent approved update" },
    ]);
  });

  it("reuses an approved owned identity's canonical profile and selected email without rewriting them", async () => {
    const person = await verifiedPerson();
    const organizationId = await insertOrganization(env.DB, "Already represented organization");
    const identity = await buildCreateIdentityStatement(env.DB, {
      userId: person.userId,
      organizationId,
      source: "staff",
      startImmediately: true,
      jobTitle: "Approved position",
      biography: "Approved biography",
    });
    await env.DB.batch([identity.statement]);
    const emailId = crypto.randomUUID();
    const secondaryEmail = "other-work-mailbox@affiliation-work.example";
    await env.DB.prepare(
      "INSERT INTO user_emails (id,user_id,email,normalized_email,verified_at,created_at) VALUES (?,?,?,?,?,?)",
    )
      .bind(emailId, person.userId, secondaryEmail, secondaryEmail, nowIso(), nowIso())
      .run();
    const before = await queryAll(
      env.DB,
      "SELECT email_id,job_title,biography,source,updated_at FROM identities WHERE id=?",
      [identity.identityId],
    );
    const prepared = await prepareVerifiedOrganizationAffiliation(env.DB, {
      userId: person.userId,
      normalizedEmail: secondaryEmail,
      emailId,
      organizationName: "Already represented organization",
      at: nowIso(),
      proofEvidence: proofEvidence(person),
      profile: { jobTitle: "Do not overwrite", biography: "Do not overwrite" },
    });
    expect(prepared.identityId).toBe(identity.identityId);
    expect(prepared.snapshot).toMatchObject({ jobTitle: "Approved position", biography: "Approved biography" });
    await env.DB.batch(prepared.statements);
    expect(
      await queryAll(env.DB, "SELECT email_id,job_title,biography,source,updated_at FROM identities WHERE id=?", [
        identity.identityId,
      ]),
    ).toEqual(before);
  });

  it("prepares new person, mailbox proof, organization and affiliation for one atomic caller batch", async () => {
    const at = nowIso();
    const person = await buildFindOrCreateUserStatement(env.DB, {
      email: "new-person@new-affiliation.example",
      firstName: "One",
      lastName: "Person",
    });
    const affiliation = await prepareVerifiedOrganizationAffiliation(env.DB, {
      userId: person.user.id,
      normalizedEmail: person.user.email,
      emailId: null,
      organizationName: "New Person Organization",
      at,
      proofEvidence: { sql: "SELECT 1 FROM users WHERE id=? AND email_verified_at=?", bindings: [person.user.id, at] },
    });
    expect(await queryAll(env.DB, "SELECT id FROM users WHERE id=?", [person.user.id])).toEqual([]);
    await env.DB.batch([
      person.statement!,
      ...prepareVerifyOwnedEmailStatements(env.DB, {
        userId: person.user.id,
        normalizedEmail: person.user.email,
        method: "magic_link",
        verifiedAt: at,
      }),
      ...affiliation.statements,
    ]);
    expect(
      await queryAll(env.DB, "SELECT user_id,email_id FROM identities WHERE id=?", [affiliation.identityId]),
    ).toEqual([{ user_id: person.user.id, email_id: null }]);
  });

  it("does not turn a pending membership application's domain reservation into organization affiliation", async () => {
    const person = await verifiedPerson();
    await seedMemberApplication({ applicantEmail: person.email, organizationDomain: "affiliation-work.example" });
    await expect(prepare(person, { organizationName: "Application Pending Organization" })).rejects.toMatchObject({
      code: "ORGANIZATION_DOMAIN_IN_USE",
    });
    expect(await queryAll(env.DB, "SELECT id FROM organizations")).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
  });

  it("rejects an existing typed-name collision without exact domain proof or an owned approved relationship", async () => {
    const person = await verifiedPerson();
    const existingId = await insertOrganization(env.DB, "Protected Existing Organization");
    await seedOrganizationAggregate(env.DB, existingId, "A");
    await expect(prepare(person, { organizationName: "Protected Existing Organization" })).rejects.toMatchObject({
      code: "ORGANIZATION_AFFILIATION_REVIEW_REQUIRED",
    });
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
  });

  it.each(["pending", "blocked"] as const)(
    "refuses autonomous activation of an existing %s relationship",
    async (state) => {
      const person = await verifiedPerson();
      const organizationId = await insertOrganization(env.DB, "Review Required Organization");
      await claimDomain(organizationId);
      const identity = await buildCreateIdentityStatement(env.DB, {
        userId: person.userId,
        organizationId,
        source: "staff",
        startImmediately: false,
      });
      await env.DB.batch([identity.statement]);
      if (state === "blocked")
        await env.DB.prepare("UPDATE identities SET ended_at=?,blocked_at=?,blocked_by_user_id=? WHERE id=?")
          .bind(nowIso(), nowIso(), person.userId, identity.identityId)
          .run();
      await expect(prepare(person, { organizationId })).rejects.toMatchObject({
        code: state === "pending" ? "IDENTITY_INVITATION_PENDING" : "IDENTITY_BLOCKED",
      });
    },
  );

  it("keeps ended affiliations immutable and creates a reviewed successor period", async () => {
    const person = await verifiedPerson();
    const organizationId = await insertOrganization(env.DB, "Historical Affiliation Organization");
    await claimDomain(organizationId);
    const previous = await prepare(person, { organizationId });
    await env.DB.batch(previous.statements);
    await env.DB.prepare("UPDATE identities SET ended_at=? WHERE id=?").bind(nowIso(), previous.identityId).run();
    const successor = await prepare(person, { organizationId });
    await env.DB.batch(successor.statements);
    expect(successor.identityId).not.toBe(previous.identityId);
    expect(
      await queryAll(env.DB, "SELECT predecessor_identity_id FROM identities WHERE id=?", [successor.identityId]),
    ).toEqual([{ predecessor_identity_id: previous.identityId }]);
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(previous.identityId).first("ended_at"),
    ).toBeTruthy();
  });

  it.each(["name_collision", "domain_collision", "proof_revoked", "person_disabled"] as const)(
    "rolls back new organization and affiliation when %s changes before commit",
    async (race) => {
      const person = await verifiedPerson();
      const prepared = await prepare(person, { organizationName: "Race Affiliation Organization" });
      const beforeAudit = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
      const beforeName = await env.DB.prepare("SELECT first_name FROM users WHERE id=?")
        .bind(person.userId)
        .first("first_name");
      const racedDb = mutateBeforeNextBatch(env.DB, async () => {
        if (race === "name_collision") await insertOrganization(env.DB, "Race Affiliation Organization");
        else if (race === "domain_collision")
          await claimDomain(await insertOrganization(env.DB, "Another Domain Owner"));
        else if (race === "proof_revoked")
          await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(nowIso(), person.sessionId).run();
        else await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(person.userId).run();
      });
      await expect(
        racedDb.batch([
          env.DB.prepare("UPDATE users SET first_name='Must roll back' WHERE id=?").bind(person.userId),
          ...prepared.statements,
        ]),
      ).rejects.toThrow();
      expect(
        await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(person.userId).first("first_name"),
      ).toBe(beforeName);
      expect(await queryAll(env.DB, "SELECT id FROM organizations WHERE id=?", [prepared.organizationId])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(beforeAudit);
      expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [person.userId])).toEqual([]);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_user_id=?", [person.userId])).toEqual(
        [],
      );
    },
  );

  it("rolls back affiliation preparation if nullable membership enrichment changes before its atomic audit", async () => {
    const person = await verifiedPerson();
    const organizationId = await insertOrganization(env.DB, "Concurrent Member Activation");
    await claimDomain(organizationId);
    const affiliation = await prepare(person, { organizationId });
    expect(affiliation.memberId).toBeNull();
    const racedDb = mutateBeforeNextBatch(env.DB, () => seedOrganizationAggregate(env.DB, organizationId, "A"));
    await expect(racedDb.batch(affiliation.statements)).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log")).toEqual([]);
  });

  it("retains the legacy membership-join adapter's atomic active-member requirement", async () => {
    const person = await verifiedPerson();
    const organizationId = await insertOrganization(env.DB, "Existing Member Join Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await claimDomain(organizationId);
    const statements = await prepareExplicitVerifiedDomainIdentityStatements(env.DB, {
      userId: person.userId,
      organizationId,
      normalizedEmail: person.email,
      at: nowIso(),
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run(),
    );
    await expect(racedDb.batch(statements)).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM identities WHERE user_id=?", [person.userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM audit_log")).toEqual([]);
  });

  it.each(["invite", "profile", "end"] as const)(
    "rolls back staff %s when the exact caller session is revoked before commit",
    async (operation) => {
      const organizationId = await insertOrganization(env.DB, "Session Guard Organization");
      const token = await staffToken();
      const staffSession = await env.DB.prepare(
        `SELECT session.id FROM sessions session
          WHERE session.user_id=(SELECT id FROM (${ADMINISTRATOR_FIXTURE_USER_SQL}))`,
      ).first<string>("id");
      const userId = await insertUser(env.DB, "session-target@affiliation-work.example");
      const identity =
        operation === "invite"
          ? null
          : await buildCreateIdentityStatement(env.DB, {
              userId,
              organizationId,
              source: "staff",
              startImmediately: true,
              jobTitle: "Original profile",
            });
      if (identity) await env.DB.batch([identity.statement]);
      const beforeIdentity = await queryAll(
        env.DB,
        "SELECT id,job_title,ended_at,updated_at FROM identities WHERE user_id=?",
        [userId],
      );
      const beforeAudits = await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id");
      const beforeOutbox = await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id");
      const racedDb = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(nowIso(), staffSession).run(),
      );
      const path = `/api/v1/organizations/${organizationId}/identities${identity ? `/${identity.identityId}` : ""}`;
      const body =
        operation === "invite"
          ? {
              userReference: "existing_user",
              userId,
              activation: { mode: "invitation" },
              showOnOrganizationProfile: true,
            }
          : operation === "profile"
            ? { profile: { jobTitle: "Must roll back" } }
            : { transition: { state: "ended", reason: "Must roll back" } };
      const response = await callApi({ ...env, DB: racedDb }, path, {
        method: operation === "invite" ? "POST" : "PATCH",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status, await response.clone().text()).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "IDENTITY_AUTHORIZATION_CHANGED" } });
      expect(
        await queryAll(env.DB, "SELECT id,job_title,ended_at,updated_at FROM identities WHERE user_id=?", [userId]),
      ).toEqual(beforeIdentity);
      expect(await queryAll(env.DB, "SELECT id FROM audit_log ORDER BY id")).toEqual(beforeAudits);
      expect(await queryAll(env.DB, "SELECT id FROM email_outbox ORDER BY id")).toEqual(beforeOutbox);
      expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [userId])).toEqual([]);
    },
  );

  it("lets authorized staff invite, profile, accept, and end a nonmember organization identity", async () => {
    const organizationId = await insertOrganization(env.DB, "Staff Nonmember Affiliation");
    const token = await staffToken();
    const userId = await insertUser(env.DB, "invited@affiliation-work.example");
    const response = await request(`/api/v1/organizations/${organizationId}/identities`, token, "POST", {
      userReference: "existing_user",
      userId,
      activation: { mode: "invitation" },
      showOnOrganizationProfile: true,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const receipt = (await response.json()) as { identityId: string };
    const prefix = `organization-identity:${receipt.identityId}:invited:`;
    const queued = await env.DB.prepare(
      "SELECT payload_json,recipient_user_id,recipient_email FROM email_outbox WHERE substr(idempotency_key,1,?)=?",
    )
      .bind(prefix.length, prefix)
      .first<{ payload_json: string; recipient_user_id: string; recipient_email: string }>();
    expect(queued).toMatchObject({ recipient_user_id: userId, recipient_email: "invited@affiliation-work.example" });
    const delivered = await deliveredEmailPayload<{ invitationToken: string }>(env.DB, env, queued!.payload_json);
    expect(delivered).toMatchObject({ organizationName: "Staff Nonmember Affiliation" });
    const updated = await request(
      `/api/v1/organizations/${organizationId}/identities/${receipt.identityId}`,
      token,
      "PATCH",
      { profile: { jobTitle: "Engineer" } },
    );
    expect(updated.status, await updated.clone().text()).toBe(200);
    const accepted = await callApi(env, "/api/v1/identities/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: delivered.invitationToken }),
    });
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const listed = await request(`/api/v1/organizations/${organizationId}/identities`, token, "GET");
    expect(listed.status, await listed.clone().text()).toBe(200);
    expect(await listed.json()).toMatchObject({
      identities: [{ id: receipt.identityId, memberId: null, state: "active", jobTitle: "Engineer" }],
    });
    const ended = await request(
      `/api/v1/organizations/${organizationId}/identities/${receipt.identityId}`,
      token,
      "PATCH",
      { transition: { state: "ended", reason: "Affiliation ended" } },
    );
    expect(ended.status, await ended.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT id FROM members WHERE organization_id=?", [organizationId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM group_memberships WHERE user_id=?", [userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM member_applications")).toEqual([]);
  });
});
