import { administratorGrants } from "./helpers/administrator";
import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import app from "./helpers/app";
import { callApi } from "./helpers/app";
import {
  addRepresentative,
  insertIndividualMembershipForUser,
  insertOrganization,
  seedOrganizationAggregate,
} from "./helpers/membership";
import { signCapabilityToken, verifyDatabaseCapability } from "../functions/_lib/services/capability-links";
import { confirmRegistrationByToken, getRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { updateUser } from "../functions/_lib/services/user-management-update";
import { anonymizeUser as anonymizeUserService } from "../functions/_lib/services/user-anonymization";
import { gateNextBatch } from "./helpers/d1-batch-gate";
import { seatInExecutiveCouncil } from "./helpers/group-leadership";
import { getPublicMemberById } from "../functions/_lib/services/membership/directory";
import { validPngBytes } from "./helpers/raster-images";
import { userDetailResponseSchema } from "../assets/shared/schemas/user-management";

let adminToken: string;

async function seedProposalSpeakerCapability(userId: string, eventId: string, signingSecret: string) {
  const proposalId = crypto.randomUUID();
  const speakerId = crypto.randomUUID();
  const linkSecret = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO session_proposals
           (id, event_id, proposer_user_id, status, proposal_type, title, abstract,
            manage_link_secret, submitted_at, updated_at)
         VALUES (?, ?, ?, 'submitted', 'talk', 'Capability test', 'Abstract', ?, datetime('now'), datetime('now'))`,
    ).bind(proposalId, eventId, userId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO proposal_speakers
           (id, proposal_id, user_id, role, status, manage_link_secret, created_at)
         VALUES (?, ?, ?, 'speaker', 'confirmed', ?, datetime('now'))`,
    ).bind(speakerId, proposalId, userId, linkSecret),
  ]);
  return {
    speakerId,
    token: await signCapabilityToken({
      signingSecret,
      linkSecret,
      purpose: "speaker_manage",
      resourceId: speakerId,
    }),
  };
}

async function setup() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  adminToken = await createAdminSession(env.DB, adminId, "admin-session-token");
  return { adminId, eventId, env };
}

function adminRequest(path: string, method: string, body?: unknown, token = adminToken): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function mountedAdminUserRoute(context: {
  req: { raw: Request };
  env: unknown;
  executionCtx?: { waitUntil(promise: Promise<unknown>): void };
}): Promise<Response> {
  const response = await app.fetch(
    context.req.raw,
    context.env as any,
    (context.executionCtx ?? { passThroughOnException: () => {}, waitUntil: () => {} }) as any,
  );
  if (response.ok) return response;
  const payload = (await response
    .clone()
    .json()
    .catch(() => ({}))) as { error?: Record<string, unknown> };
  const error = Object.assign(
    new Error(String(payload.error?.message ?? "Request failed")),
    { status: response.status },
    payload.error ?? {},
  );
  throw error;
}

const patchUser = mountedAdminUserRoute;
const anonymizeUser = mountedAdminUserRoute;

async function seedUser(_db: DatabaseLike, email: string): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `
    INSERT INTO users (id, email, normalized_email, first_name, last_name, active, created_at, updated_at)
    VALUES (?, ?, ?, 'Test', 'User', 1, datetime('now'), datetime('now'));
  `,
  )
    .bind(userId, email, email)
    .run();
  return userId;
}

async function lifecycleTarget(kind: string) {
  const userId = await seedUser(env.DB, "lifecycle-publication@example.test");
  let identityId: string | null = null;
  let publicKey: string | null = null;
  if (kind.startsWith("individual")) {
    const member = await insertIndividualMembershipForUser(env.DB, userId);
    identityId = member.identityId;
    publicKey = member.memberId;
    if (kind === "individual")
      await env.DB.prepare("UPDATE identities SET biography=?,links_json=? WHERE id=?")
        .bind("Public biography", JSON.stringify(["https://example.test/profile"]), identityId)
        .run();
    if (kind === "individual_ended")
      await env.DB.prepare("UPDATE identities SET ended_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
        .bind(identityId)
        .run();
    if (kind === "individual_blank" || kind === "individual_photo")
      await env.DB.prepare("UPDATE users SET first_name=NULL,last_name=NULL WHERE id=?").bind(userId).run();
    if (kind === "individual_photo") {
      const key = `headshots/${userId}/lifecycle.png`;
      await env.SPEAKER_UPLOADS_BUCKET!.put(key, validPngBytes().buffer, {
        httpMetadata: { contentType: "image/png" },
      });
      await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(key, userId).run();
    }
  } else if (kind !== "nonmember") {
    const organizationId = await insertOrganization(env.DB, "Lifecycle Publication Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId);
    identityId = await addRepresentative(env.DB, memberId, userId, {
      jobTitle: "Engineer",
      showOnOrgProfile: kind !== "hidden",
    });
    publicKey = organizationId;
    if (kind === "inactive")
      await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(memberId).run();
  }
  return { userId, identityId, publicKey };
}

// ── Deactivation / reactivation ────────────────────────────────────────────

describe("admin user deactivation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it.each(
    ["deactivate", "anonymize"].flatMap((operation) =>
      [
        "organization",
        "individual",
        "individual_empty",
        "individual_ended",
        "individual_blank",
        "individual_photo",
        "hidden",
        "inactive",
        "nonmember",
      ].map((kind) => ({ operation, kind })),
    ),
  )("publishes only actual member data changes on $operation for $kind", async ({ operation, kind }) => {
    await setup();
    const target = await lifecycleTarget(kind);
    const read = () => (target.publicKey ? getPublicMemberById(env.DB, target.publicKey) : Promise.resolve(null));
    const before = await read();
    const attempt = () =>
      callApi(
        env,
        adminRequest(
          `/api/v1/users/${target.userId}${operation === "anonymize" ? "/anonymize" : ""}`,
          operation === "anonymize" ? "POST" : "PATCH",
          operation === "anonymize" ? undefined : { active: false },
        ),
      );
    const response = await attempt();
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await read();
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    const expected =
      operation === "anonymize"
        ? ["organization", "individual", "individual_empty", "individual_ended", "individual_photo"].includes(kind)
        : ["organization", "individual"].includes(kind);
    expect(changed).toBe(expected);
    expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual(
      changed ? [{ resource_id: target.userId, reason_code: "user_profile_changed" }] : [],
    );
    const repeated = await attempt();
    expect(repeated.status).toBe(operation === "anonymize" ? 409 : 200);
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toHaveLength(changed ? 1 : 0);
  });

  it.each(
    ["deactivate", "anonymize"].flatMap((operation) => ["request", "audit"].map((failure) => ({ operation, failure }))),
  )("rolls back $operation on $failure failure and permits retry", async ({ operation, failure }) => {
    await setup();
    const target = await lifecycleTarget("organization");
    const targetToken = await createAdminSession(env.DB, target.userId, "lifecycle-target-session");
    expect(targetToken).toBeTruthy();
    const state = async () => ({
      users: await queryAll(
        env.DB,
        "SELECT email,first_name,last_name,active,pii_redacted_at,updated_at FROM users WHERE id=?",
        target.userId,
      ),
      identities: await queryAll(
        env.DB,
        "SELECT id,ended_at,job_title,updated_at FROM identities WHERE user_id=?",
        target.userId,
      ),
      sessions: await queryAll(env.DB, "SELECT id,revoked_at FROM sessions WHERE user_id=?", target.userId),
    });
    const before = await state();
    const attempt = () =>
      callApi(
        env,
        adminRequest(
          `/api/v1/users/${target.userId}${operation === "anonymize" ? "/anonymize" : ""}`,
          operation === "anonymize" ? "POST" : "PATCH",
          operation === "anonymize" ? undefined : { active: false },
        ),
      );
    const action = operation === "anonymize" ? "user_anonymized" : "user_updated";
    await env.DB.prepare(`CREATE TRIGGER fail_user_lifecycle BEFORE INSERT ON ${failure === "request" ? "site_publication_requests" : "audit_log"}
        ${failure === "audit" ? `WHEN NEW.action='${action}'` : ""}
        BEGIN SELECT RAISE(ABORT,'SYNTHETIC_USER_LIFECYCLE_FAILURE'); END`).run();
    try {
      expect((await attempt()).status).toBe(500);
      expect(await state()).toEqual(before);
      expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
      expect(
        await queryAll(env.DB, "SELECT id FROM audit_log WHERE action=? AND entity_id=?", [action, target.userId]),
      ).toEqual([]);
      expect(await queryAll(env.DB, "SELECT object_key FROM storage_deletion_outbox")).toEqual([]);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_user_lifecycle").run();
    }
    const retried = await attempt();
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(await queryAll(env.DB, "SELECT resource_id FROM site_publication_requests")).toEqual([
      { resource_id: target.userId },
    ]);
  });

  it("leaves no public redaction request when a concurrent email correction wins", async () => {
    const { adminId } = await setup();
    const target = await lifecycleTarget("organization");
    const actor: Parameters<typeof anonymizeUserService>[1] = {
      identityType: "user",
      id: adminId,
      email: "admin@pkic.org",
      grants: administratorGrants,
    };
    const gate = gateNextBatch(env.DB);
    const mutation = anonymizeUserService(gate.db, actor, target.userId);
    await gate.reached;
    await updateUser(env.DB, actor, target.userId, { email: "lifecycle-winner@example.test" });
    gate.release();
    await expect(mutation).rejects.toMatchObject({ code: "ANONYMIZATION_CONFLICT" });
    expect(await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(target.userId).first("email")).toBe(
      "lifecycle-winner@example.test",
    );
    expect(
      await env.DB.prepare("SELECT ended_at FROM identities WHERE id=?").bind(target.identityId).first("ended_at"),
    ).toBeNull();
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests")).toEqual([]);
  });

  it.each(["individual", "organization", "hidden", "inactive", "nonmember"] as const)(
    "queues staff name edits only for public member profiles: %s",
    async (visibility) => {
      await setup();
      const userId = await seedUser(env.DB, "name-publication@example.test");
      if (visibility === "individual" || visibility === "inactive") {
        const member = await insertIndividualMembershipForUser(env.DB, userId);
        if (visibility === "inactive")
          await env.DB.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(member.memberId).run();
      } else if (visibility !== "nonmember") {
        const memberId = await seedOrganizationAggregate(env.DB, await insertOrganization(env.DB));
        await addRepresentative(env.DB, memberId, userId, { showOnOrgProfile: visibility !== "hidden" });
      }
      const save = () =>
        callApi(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { firstName: "Published", lastName: "Name" }));
      const saved = await save();
      expect(saved.status, await saved.clone().text()).toBe(200);
      const expected =
        visibility === "individual" || visibility === "organization"
          ? [{ resource_id: userId, reason_code: "user_profile_changed" }]
          : [];
      expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual(expected);
      const repeated = await save();
      expect(repeated.status, await repeated.clone().text()).toBe(200);
      expect(await queryAll(env.DB, "SELECT resource_id,reason_code FROM site_publication_requests")).toEqual(expected);
    },
  );

  it("deactivates an active user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "target@example.test");

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { active: false }), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean; user: { active: boolean } };
    expect(data.success).toBe(true);
    expect(data.user.active).toBe(false);

    const row = (await queryAll<{ active: number }>(env.DB, "SELECT active FROM users WHERE id = ?", [userId]))[0];
    expect(row.active).toBe(0);
  });

  it("reactivates a deactivated user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "inactive@example.test");
    await env.DB.prepare(`UPDATE users SET active = 0 WHERE id = '${userId}'`).run();

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { active: true }), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { user: { active: boolean } };
    expect(data.user.active).toBe(true);
  });

  it("rejects legacy role changes even when combined with an ordinary profile update", async () => {
    await setup();
    const targetId = await seedUser(env.DB, "legacy-role-target@example.test");
    const response = await app.fetch(
      adminRequest(`/api/v1/users/${targetId}`, "PATCH", { role: "admin", firstName: "Unauthorized" }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(400);
    expect(
      (await queryAll<{ first_name: string | null }>(env.DB, "SELECT first_name FROM users WHERE id = ?", targetId))[0]
        .first_name,
    ).toBe("Test");
  });

  it("preserves users:write name updates without access:grant", async () => {
    await setup();
    const staffId = await seedUser(env.DB, "profile-editor@example.test");
    const targetId = await seedUser(env.DB, "email-before@example.test");
    const adminId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0].id;
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'users:write', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "profile-editor-session");

    const response = await app.fetch(
      adminRequest(`/api/v1/users/${targetId}`, "PATCH", { preferredName: "Still editable" }, staffToken),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    expect(
      (
        await queryAll<{ email: string; preferred_name: string | null }>(
          env.DB,
          "SELECT email, preferred_name FROM users WHERE id = ?",
          targetId,
        )
      )[0],
    ).toEqual({ email: "email-before@example.test", preferred_name: "Still editable" });
  });

  it("requires access:grant for a direct primary-email correction", async () => {
    await setup();
    const staffId = await seedUser(env.DB, "email-editor@example.test");
    const targetId = await seedUser(env.DB, "email-protected@example.test");
    const adminId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0].id;
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'users:write', ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, adminId)
      .run();
    const staffToken = await createAdminSession(env.DB, staffId, "email-editor-session");

    const response = await app.fetch(
      adminRequest(`/api/v1/users/${targetId}`, "PATCH", { email: "attacker@example.test" }, staffToken),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(403);
    expect((await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", targetId))[0].email).toBe(
      "email-protected@example.test",
    );
  });

  it("allows an access:grant staff correction and revokes prior login credentials", async () => {
    await setup();
    const staffId = await seedUser(env.DB, "identity-recovery@example.test");
    const targetId = await seedUser(env.DB, "identity-before@example.test");
    const adminId = (
      await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
    )[0].id;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffId, "users:write", adminId),
      env.DB.prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
           VALUES (?, ?, ?, ?, datetime('now'))`,
      ).bind(crypto.randomUUID(), staffId, "access:grant", adminId),
      env.DB.prepare(
        "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, datetime('now', '+1 day'), datetime('now'))",
      ).bind(crypto.randomUUID(), targetId, `session-${crypto.randomUUID()}`),
    ]);
    const staffToken = await createAdminSession(env.DB, staffId, "identity-recovery-session");

    const response = await app.fetch(
      adminRequest(`/api/v1/users/${targetId}`, "PATCH", { email: "identity-after@example.test" }, staffToken),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    await expect(
      queryAll<{ email: string; sessions: number }>(
        env.DB,
        `SELECT u.email,
                (SELECT COUNT(*) FROM sessions WHERE user_id = u.id AND revoked_at IS NULL) AS sessions
           FROM users u WHERE u.id = ?`,
        [targetId],
      ),
    ).resolves.toEqual([{ email: "identity-after@example.test", sessions: 0 }]);
  });

  it("invalidates a stale pending confirmation when an admin changes the primary email", async () => {
    const { adminId, eventId } = await setup();
    const userId = await seedUser(env.DB, "email-original@example.test");
    const registrationId = crypto.randomUUID();
    const confirmationLinkSecret = crypto.randomUUID();
    const manageLinkSecret = crypto.randomUUID();
    const signingSecret = "admin-email-correction-secret";
    const staleToken = await signCapabilityToken({
      signingSecret,
      linkSecret: confirmationLinkSecret,
      purpose: "registration_confirm",
      resourceId: registrationId,
    });
    const staleManageToken = await signCapabilityToken({
      signingSecret,
      linkSecret: manageLinkSecret,
      purpose: "registration_manage",
      resourceId: registrationId,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO registrations
             (id, event_id, user_id, status, attendance_type, source_type,
              confirmation_link_secret, manage_link_secret, pending_confirmation_deadline_at,
              created_at, updated_at)
           VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'admin', ?, ?,
                   datetime('now', '+1 day'), datetime('now'), datetime('now'))`,
      ).bind(registrationId, eventId, userId, confirmationLinkSecret, manageLinkSecret),
      env.DB.prepare(
        `UPDATE users
              SET pending_email = 'email-pending@example.test',
                  pending_email_expires_at = datetime('now', '+1 day'),
                  pending_email_change_registration_id = ?
            WHERE id = ?`,
      ).bind(registrationId, userId),
    ]);
    const speakerCapability = await seedProposalSpeakerCapability(userId, eventId, signingSecret);

    await updateUser(
      env.DB,
      { identityType: "user", id: adminId, email: "admin@pkic.org", grants: administratorGrants },
      userId,
      {
        email: "email-admin-set@example.test",
      },
    );

    expect(
      (
        await queryAll<{
          email: string;
          pending_email: string | null;
          pending_email_change_registration_id: string | null;
        }>(env.DB, "SELECT email, pending_email, pending_email_change_registration_id FROM users WHERE id = ?", userId)
      )[0],
    ).toEqual({
      email: "email-admin-set@example.test",
      pending_email: null,
      pending_email_change_registration_id: null,
    });
    expect(
      (
        await queryAll<{ confirmation_link_secret: string | null }>(
          env.DB,
          "SELECT confirmation_link_secret FROM registrations WHERE id = ?",
          registrationId,
        )
      )[0].confirmation_link_secret,
    ).toBeNull();

    await expect(
      confirmRegistrationByToken(env.DB, {
        token: staleToken,
        waitlistClaimWindowHours: 24,
        signingSecret,
      }),
    ).rejects.toMatchObject({ code: "CONFIRM_TOKEN_INVALID" });
    await expect(getRegistrationByManageToken(env.DB, staleManageToken, signingSecret)).rejects.toMatchObject({
      code: "REGISTRATION_NOT_FOUND",
    });
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "speaker_manage",
        token: speakerCapability.token,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
    expect((await queryAll<{ email: string }>(env.DB, "SELECT email FROM users WHERE id = ?", userId))[0].email).toBe(
      "email-admin-set@example.test",
    );
  });

  it("updates the user-wide preferred name without copying identity profile fields", async () => {
    await setup();
    const userId = await seedUser(env.DB, "profile@example.test");

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/users/${userId}`, "PATCH", {
          preferredName: "Speaker",
        }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{ preferred_name: string | null }>(env.DB, "SELECT preferred_name FROM users WHERE id = ?", [
        userId,
      ])
    )[0];
    expect(row).toEqual({ preferred_name: "Speaker" });
  });

  it("persists profile edits through the full router pipeline (regression: a stale duplicate PATCH route previously shadowed this handler)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "router-profile@example.test");

    const response = await app.fetch(
      adminRequest(`/api/v1/users/${userId}`, "PATCH", {
        firstName: "Router",
        lastName: "Tested",
        preferredName: "QA",
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      }>(env.DB, "SELECT first_name, last_name, preferred_name FROM users WHERE id = ?", [userId])
    )[0];
    expect(row.first_name).toBe("Router");
    expect(row.last_name).toBe("Tested");
    expect(row.preferred_name).toBe("QA");
  });

  it("refuses to deactivate the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      patchUser(
        createContext(env, adminRequest(`/api/v1/users/${adminId}`, "PATCH", { active: false }), {
          userId: adminId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("writes an audit log entry on deactivation", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-deact@example.test");

    await patchUser(
      createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { active: false }), { userId }),
    );

    const entry = (
      await queryAll<{ action: string }>(
        env.DB,
        "SELECT action FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    )[0];
    expect(entry.action).toBe("user_updated");
  });

  it("records changed field names without copying profile PII into the audit log", async () => {
    await setup();
    const userId = await seedUser(env.DB, "private-update@example.test");

    await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/users/${userId}`, "PATCH", {
          email: "new-private@example.test",
          preferredName: "Private preferred name",
        }),
        { userId },
      ),
    );

    const [{ details_json: detailsJson }] = await queryAll<{ details_json: string }>(
      env.DB,
      "SELECT details_json FROM audit_log WHERE entity_id = ? AND action = 'user_updated'",
      userId,
    );
    expect(detailsJson).not.toContain("private-update@example.test");
    expect(detailsJson).not.toContain("new-private@example.test");
    expect(detailsJson).not.toContain("Private preferred name");
    expect(JSON.parse(detailsJson)).toMatchObject({
      changedFields: { to: expect.arrayContaining(["email", "preferredName"]) },
    });
  });

  it("does not take council membership from the account form: the Executive Council group's roster says who sits", async () => {
    await setup();
    const userId = await seedUser(env.DB, "ec-member@example.test");
    // The field is no longer part of the update contract; the report of the
    // flag comes from the group (#104).
    await expect(
      patchUser(
        createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { isEcMember: true, firstName: "Sam" }), {
          userId,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });

    await seatInExecutiveCouncil(env.DB, userId);
    const getResponse = await app.fetch(
      adminRequest(`/api/v1/users/${userId}`, "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(((await getResponse.json()) as { user: { isEcMember: boolean } }).user.isEcMember).toBe(true);
  });

  it("returns the organization identity's own profile", async () => {
    await setup();
    const userId = await seedUser(env.DB, "capacity-profile@example.test");
    const organizationId = await insertOrganization(env.DB, "Canonical Capacity Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);
    await env.DB.prepare(
      `UPDATE identities
            SET job_title = 'Capacity Title', biography = 'Capacity biography',
                links_json = '["https://capacity.example.test"]'
          WHERE organization_id = ? AND user_id = ?`,
    )
      .bind(organizationId, userId)
      .run();

    const response = await app.fetch(
      adminRequest(`/api/v1/users/${userId}`, "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    expect(response.status).toBe(200);
    const body = userDetailResponseSchema.parse(await response.json());
    expect(body.user.identities).toEqual([
      expect.objectContaining({
        organizationId,
        organizationName: "Canonical Capacity Organization",
        email: "capacity-profile@example.test",
        jobTitle: "Capacity Title",
        biography: "Capacity biography",
        links: ["https://capacity.example.test"],
      }),
    ]);
  });

  it("rejects an empty patch body (no fields provided)", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      patchUser(createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", {}), { userId })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

// ── Anonymization ──────────────────────────────────────────────────────────

describe("admin user anonymization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes PII and deactivates the user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "pii-person@example.test");

    const response = await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { success: boolean; userId: string };
    expect(data.success).toBe(true);
    expect(data.userId).toBe(userId);

    const row = (
      await queryAll<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        active: number;
        pii_redacted_at: string | null;
      }>(env.DB, "SELECT email, first_name, last_name, active, pii_redacted_at FROM users WHERE id = ?", [userId])
    )[0];

    expect(row.email).toMatch(/^redacted-/);
    expect(row.first_name).toBeNull();
    expect(row.last_name).toBeNull();
    expect(row.active).toBe(0);
    expect(row.pii_redacted_at).toBeTruthy();
  });

  it("removes the person's affiliation text: identity titles, an individual title and unreviewed affiliation text", async () => {
    await setup();
    const userId = await seedUser(env.DB, "affiliation-pii@example.test");
    const organizationId = await insertOrganization(env.DB, "Affiliation Redaction Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    const identityId = await addRepresentative(env.DB, memberId, userId, { jobTitle: "Principal Engineer" });
    await env.DB.batch([
      env.DB.prepare("UPDATE identities SET biography = 'Identity biography', links_json = '[]' WHERE id = ?").bind(
        identityId,
      ),
      env.DB.prepare(
        `INSERT INTO individual_job_titles (user_id, job_title, created_at, updated_at)
         VALUES (?, 'Independent Consultant', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ).bind(userId),
      env.DB.prepare(
        `INSERT INTO affiliation_reviews (id, user_id, organization_name, normalized_name, job_title, group_key, source_type, source_id, created_at)
         VALUES (?, ?, 'Unmatched Co', 'unmatched co', 'Unmatched Role', 'unmatched', 'user_profile', ?, '2026-01-01T00:00:00.000Z')`,
      ).bind(crypto.randomUUID(), userId, userId),
    ]);

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    expect(
      await queryAll(env.DB, "SELECT job_title, biography, links_json FROM identities WHERE id = ?", [identityId]),
    ).toEqual([{ job_title: null, biography: null, links_json: null }]);
    expect(await queryAll(env.DB, "SELECT user_id FROM individual_job_titles WHERE user_id = ?", [userId])).toEqual([]);
    expect(await queryAll(env.DB, "SELECT id FROM affiliation_reviews WHERE user_id = ?", [userId])).toEqual([]);
  });

  it("closes active organization relationships so redacted users disappear from rosters and counts", async () => {
    await setup();
    const userId = await seedUser(env.DB, "representative-to-anonymize@example.test");
    const organizationId = await insertOrganization(env.DB, "Anonymization Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    expect(
      await queryAll(
        env.DB,
        "SELECT ended_at IS NOT NULL AS closed FROM identities WHERE organization_id = ? AND user_id = ?",
        [organizationId, userId],
      ),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT COUNT(*) AS total FROM identities WHERE organization_id = ? AND ended_at IS NULL",
        organizationId,
      ),
    ).toEqual([{ total: 0 }]);
  });

  it("revokes all active sessions for the anonymized user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "session-holder@example.test");

    // Give the target user an active session
    await createAdminSession(env.DB, userId, "target-user-token");

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    const sessions = await queryAll<{ revoked_at: string | null }>(
      env.DB,
      "SELECT revoked_at FROM sessions WHERE user_id = ?",
      [userId],
    );
    expect(sessions.every((s) => s.revoked_at !== null)).toBe(true);
  });

  it("removes alternate identities and credentials and revokes durable access tokens", async () => {
    await setup();
    const userId = await seedUser(env.DB, "credentials@example.test");
    const [{ id: eventId }] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM events ORDER BY created_at LIMIT 1",
    );
    const registrationId = crypto.randomUUID();
    const confirmationLinkSecret = crypto.randomUUID();
    const manageLinkSecret = crypto.randomUUID();
    const signingSecret = "anonymization-capability-secret";
    const confirmationToken = await signCapabilityToken({
      signingSecret,
      linkSecret: confirmationLinkSecret,
      purpose: "registration_confirm",
      resourceId: registrationId,
    });
    const manageToken = await signCapabilityToken({
      signingSecret,
      linkSecret: manageLinkSecret,
      purpose: "registration_manage",
      resourceId: registrationId,
    });
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO registrations
           (id, event_id, user_id, status, attendance_type, source_type,
            confirmation_link_secret, manage_link_secret, created_at, updated_at)
         VALUES (?, ?, ?, 'pending_email_confirmation', 'virtual', 'admin', ?, ?, datetime('now'), datetime('now'))`,
      ).bind(registrationId, eventId, userId, confirmationLinkSecret, manageLinkSecret),
      env.DB.prepare(
        "INSERT INTO user_emails (id, user_id, email, normalized_email, created_at) VALUES (?, ?, ?, ?, datetime('now'))",
      ).bind(crypto.randomUUID(), userId, "alias@example.test", "alias@example.test"),
      env.DB.prepare(
        `INSERT INTO passkey_credentials
             (id, user_id, credential_id, public_key, sign_count, device_name, created_at)
           VALUES (?, ?, ?, 'public-key', 0, 'Personal security key', datetime('now'))`,
      ).bind(crypto.randomUUID(), userId, `credential-${crypto.randomUUID()}`),
      env.DB.prepare(
        `UPDATE users SET pending_email = 'pending@example.test', pending_email_expires_at = datetime('now', '+1 day'),
                            pending_email_change_registration_id = ?,
                            is_ec_member = 1
           WHERE id = ?`,
      ).bind(registrationId, userId),
    ]);
    const speakerCapability = await seedProposalSpeakerCapability(userId, eventId, signingSecret);

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id = ?", userId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM passkey_credentials WHERE user_id = ?", userId)).toHaveLength(0);
    const [user] = await queryAll<{
      pending_email: string | null;
      is_ec_member: number;
    }>(env.DB, "SELECT pending_email, is_ec_member FROM users WHERE id = ?", userId);
    expect(user).toMatchObject({ pending_email: null, is_ec_member: 0 });
    const [registration] = await queryAll<{
      confirmation_link_secret: string | null;
      manage_link_secret: string;
      status: string;
    }>(
      env.DB,
      "SELECT confirmation_link_secret, manage_link_secret, status FROM registrations WHERE id = ?",
      registrationId,
    );
    expect(registration).toMatchObject({ confirmation_link_secret: null, status: "pending_email_confirmation" });
    expect(registration.manage_link_secret).not.toBe(manageLinkSecret);
    await expect(getRegistrationByManageToken(env.DB, manageToken, signingSecret)).rejects.toMatchObject({
      code: "REGISTRATION_NOT_FOUND",
    });
    await expect(
      confirmRegistrationByToken(env.DB, {
        token: confirmationToken,
        waitlistClaimWindowHours: 24,
        signingSecret,
      }),
    ).rejects.toMatchObject({ code: "CONFIRM_TOKEN_INVALID" });
    await expect(
      verifyDatabaseCapability({
        db: env.DB,
        signingSecret,
        purpose: "speaker_manage",
        token: speakerCapability.token,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid" });
  });

  it("durably queues deletion of the prior headshot while clearing its pointer", async () => {
    await setup();
    const userId = await seedUser(env.DB, "headshot-anon@example.test");
    const key = `headshots/${userId}/before-anonymize.jpg`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(key, userId).run();

    await anonymizeUser(
      createContext(
        { ...(env as any), SPEAKER_UPLOADS_BUCKET: undefined },
        adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"),
        {
          userId,
        },
      ),
    );

    const [outbox] = await queryAll<{ bucket: string; object_key: string }>(
      env.DB,
      "SELECT bucket, object_key FROM storage_deletion_outbox WHERE object_key = ?",
      key,
    );
    expect(outbox).toEqual({ bucket: "speaker_uploads", object_key: key });
    const [user] = await queryAll<{ headshot_r2_key: string | null }>(
      env.DB,
      "SELECT headshot_r2_key FROM users WHERE id = ?",
      userId,
    );
    expect(user.headshot_r2_key).toBeNull();
  });

  it("refuses to anonymize an already-anonymized user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "already-anon@example.test");

    // Anonymize once
    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    // Second attempt should be rejected
    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });

  it("rolls back a stale admin update that loses to anonymization", async () => {
    const { adminId } = await setup();
    const userId = await seedUser(env.DB, "race-update@example.test");
    await env.DB.prepare("UPDATE users SET first_name = ? WHERE id = ?").bind("Private", userId).run();

    const gate = gateNextBatch(env.DB);
    const staleUpdate = updateUser(
      gate.db,
      { identityType: "user", id: adminId, email: "admin@pkic.org", grants: administratorGrants },
      userId,
      {
        email: "restored@example.test",
        firstName: "Stale restored name",
        active: false,
      },
    );
    await gate.reached;

    await anonymizeUserService(
      env.DB,
      { identityType: "user", id: adminId, email: "admin@pkic.org", grants: administratorGrants },
      userId,
    );
    gate.release();

    await expect(staleUpdate).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
    const [user] = await queryAll<{
      email: string;
      first_name: string | null;
      pending_email: string | null;
      active: number;
      pii_redacted_at: string | null;
    }>(env.DB, "SELECT email, first_name, pending_email, active, pii_redacted_at FROM users WHERE id = ?", userId);
    expect(user.email).toBe(`redacted-${userId}@anonymized.invalid`);
    expect(user.first_name).toBeNull();
    expect(user.pending_email).toBeNull();
    expect(user.active).toBe(0);
    expect(user.pii_redacted_at).toBeTruthy();
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user_updated'", userId),
    ).toHaveLength(0);
  });

  it("rolls back stale anonymization when an admin update wins the race", async () => {
    const { adminId } = await setup();
    const userId = await seedUser(env.DB, "race-anonymize@example.test");
    const gate = gateNextBatch(env.DB);
    const staleAnonymization = anonymizeUserService(
      gate.db,
      { identityType: "user", id: adminId, email: "admin@pkic.org", grants: administratorGrants },
      userId,
    );
    await gate.reached;

    await updateUser(
      env.DB,
      { identityType: "user", id: adminId, email: "admin@pkic.org", grants: administratorGrants },
      userId,
      {
        email: "race-winner@example.test",
        firstName: "Winner",
      },
    );
    gate.release();

    await expect(staleAnonymization).rejects.toMatchObject({ code: "ANONYMIZATION_CONFLICT" });
    const [user] = await queryAll<{
      email: string;
      first_name: string | null;
      active: number;
      pii_redacted_at: string | null;
    }>(env.DB, "SELECT email, first_name, active, pii_redacted_at FROM users WHERE id = ?", userId);
    expect(user).toEqual({
      email: "race-winner@example.test",
      first_name: "Winner",
      active: 1,
      pii_redacted_at: null,
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user_anonymized'", userId),
    ).toHaveLength(0);
  });

  it("rolls back a user update when users:write is revoked after request authorization", async () => {
    await setup();
    const actorId = await seedUser(env.DB, "revoked-user-write@example.test");
    const targetUserId = await seedUser(env.DB, "revoked-user-write-target@example.test");
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
       VALUES (?, ?, 'users:write', ?, datetime('now'))`,
    )
      .bind(grantId, actorId, actorId)
      .run();

    const gate = gateNextBatch(env.DB);
    const mutation = updateUser(
      gate.db,
      { identityType: "user", id: actorId, email: "revoked-user-write@example.test" },
      targetUserId,
      { firstName: "This update must not commit" },
    );
    await gate.reached;
    await env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?").bind(grantId).run();
    gate.release();

    await expect(mutation).rejects.toMatchObject({ code: "USER_AUTHORIZATION_CHANGED", status: 409 });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user_updated'", targetUserId),
    ).toEqual([]);
    expect(
      await queryAll<{ first_name: string | null }>(env.DB, "SELECT first_name FROM users WHERE id = ?", targetUserId),
    ).toEqual([{ first_name: "Test" }]);
  });

  it("refuses to anonymize the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      anonymizeUser(
        createContext(env, adminRequest(`/api/v1/users/${adminId}/anonymize`, "POST"), { userId: adminId }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 404 for a non-existent user", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit log entry on anonymization", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-anon@example.test");

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    const entry = (
      await queryAll<{ action: string; details_json: string }>(
        env.DB,
        "SELECT action, details_json FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1",
        [userId],
      )
    )[0];
    expect(entry.action).toBe("user_anonymized");
    expect(entry.details_json).not.toContain("audit-anon@example.test");
    expect(JSON.parse(entry.details_json)).toMatchObject({
      authenticationRevoked: { to: true },
      profileRedacted: { to: true },
    });
  });

  /*
   * What has to outlive the person.
   *
   * Erasure is not negotiable and the individual goes. The consortium still
   * relies on facts that were never really about them: that a representative
   * of this organization accepted an agreement on a date, and that a ballot
   * was cast in that capacity. Those stay true once the person is gone, and
   * they are what an audit — or a dispute — is answered from.
   *
   * The point of the assertion is the direction of travel: anonymization
   * redacts the user row and revokes their access, and must not follow the
   * foreign keys outward into the record of what their organization did.
   */
  it("keeps the organizational record of what a person did on their organization's behalf", async () => {
    await setup();
    const userId = await seedUser(env.DB, "ipr-signer@example.test");
    const eventId = crypto.randomUUID();
    const at = "2026-01-01T00:00:00.000Z";
    await env.DB.prepare(
      `INSERT INTO events (id, slug, name, timezone, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, ?, 'Anonymization Event', 'UTC', 'invite_or_open', 5, '{}', ?, ?)`,
    )
      .bind(eventId, `anonymization-${eventId.slice(0, 8)}`, at, at)
      .run();
    // The acceptance has to hang off something the person actually did — a
    // trigger refuses one that names neither a registration nor a proposal —
    // so the record is anchored rather than free-floating.
    const registrationId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO registrations
         (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
       VALUES (?, ?, ?, 'registered', 'in_person', 'test', ?, ?, ?)`,
    )
      .bind(registrationId, eventId, userId, `secret-${registrationId}`, at, at)
      .run();
    await env.DB.prepare(
      `INSERT INTO consent_acceptances
         (id, registration_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
       VALUES (?, ?, ?, ?, 'attendee', 'ipr-agreement', '1', ?)`,
    )
      .bind(crypto.randomUUID(), registrationId, eventId, userId, at)
      .run();

    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    const [acceptance] = await queryAll<{ term_key: string; term_version: string; accepted_at: string }>(
      env.DB,
      "SELECT term_key, term_version, accepted_at FROM consent_acceptances WHERE user_id = ?",
      [userId],
    );
    expect(acceptance, "the acceptance is the organization's, and survives the person").toBeTruthy();
    expect(acceptance.term_key).toBe("ipr-agreement");
    // The version and the date are the whole value of the record: which terms,
    // and when. A surviving row that lost either answers nothing.
    expect(acceptance.term_version).toBe("1");
    expect(acceptance.accepted_at).toBe(at);

    // And the person really is gone from the row it points at.
    const [user] = await queryAll<{ email: string; first_name: string | null }>(
      env.DB,
      "SELECT email, first_name FROM users WHERE id = ?",
      [userId],
    );
    expect(user.email).not.toContain("ipr-signer");
    expect(user.first_name).toBeNull();
  });

  it("does not allow an anonymized account to be repopulated or reactivated", async () => {
    await setup();
    const userId = await seedUser(env.DB, "cannot-restore@example.test");
    await anonymizeUser(createContext(env, adminRequest(`/api/v1/users/${userId}/anonymize`, "POST"), { userId }));

    await expect(
      patchUser(createContext(env, adminRequest(`/api/v1/users/${userId}`, "PATCH", { active: true }), { userId })),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });
});

// ── Type filter (member vs. event-attendee vs. contact-only) ───────────────
// Computed from the existing `members`/`event_participants` tables.

describe("users list — type filter", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedMember(email: string): Promise<string> {
    const userId = await seedUser(env.DB, email);
    await insertIndividualMembershipForUser(env.DB, userId, "H5");
    return userId;
  }

  async function seedEventParticipant(eventId: string, email: string, roleCount = 1): Promise<string> {
    const userId = await seedUser(env.DB, email);
    const roles = ["speaker", "moderator", "organizer"];
    for (let i = 0; i < roleCount; i++) {
      await env.DB.prepare(
        `INSERT INTO event_participants (id, event_id, user_id, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))`,
      )
        .bind(crypto.randomUUID(), eventId, userId, roles[i])
        .run();
    }
    return userId;
  }

  interface ListedUser {
    email: string;
    type: "member" | "event_attendee" | "contact_only";
    organizationNames: string[];
    organizationCount: number;
  }

  async function listUsers(query: string): Promise<{ users: ListedUser[] }> {
    const response = await callApi(env, adminRequest(`/api/v1/users?${query}`, "GET"), undefined, { maxRoundTrips: 1 });
    expect(response.status).toBe(200);
    return response.json();
  }

  it("classifies a user with a members row as 'member'", async () => {
    await setup();
    await seedMember("type-member@example.test");
    await seedUser(env.DB, "type-member-decoy@example.test");

    const data = await listUsers("type=member&q=type-member@example.test");
    expect(data.users.map((u) => u.email)).toEqual(["type-member@example.test"]);
    expect(data.users[0].type).toBe("member");
    // An individual membership is one active representation with no
    // organization to name.
    expect(data.users[0].organizationCount).toBe(1);
    expect(data.users[0].organizationNames).toEqual([]);
  });

  it("classifies a user with direct event roles as an event attendee", async () => {
    const { eventId } = await setup();
    await seedEventParticipant(eventId, "type-attendee@example.test", 2);

    const data = await listUsers("type=event_attendee&q=type-attendee@example.test");
    expect(data.users.map((u) => u.email)).toEqual(["type-attendee@example.test"]);
    expect(data.users[0].type).toBe("event_attendee");
    expect(data.users[0].organizationCount).toBe(0);
  });

  it("classifies a bare user (no membership, no event participation) as 'contact_only'", async () => {
    await setup();
    await seedUser(env.DB, "type-contact@example.test");

    const data = await listUsers("type=contact_only&q=type-contact@example.test");
    expect(data.users.map((u) => u.email)).toEqual(["type-contact@example.test"]);
    expect(data.users[0].type).toBe("contact_only");
    expect(data.users[0].organizationCount).toBe(0);
  });

  it("finds a long partial email without invoking D1's LIKE-pattern limit", async () => {
    await setup();
    const email = "e2e-duplicate-1787220512185@e2e-users-dup-1787220512185.test";
    await seedUser(env.DB, email);

    const longSubstring = email.slice(4);
    expect(new TextEncoder().encode(longSubstring).byteLength).toBeGreaterThan(50);

    const data = await listUsers(`q=${encodeURIComponent(longSubstring)}`);
    expect(data.users.map((user) => user.email)).toEqual([email]);
  });

  it("a member who also has event_participants rows is still classified as 'member', not 'event_attendee'", async () => {
    const { eventId } = await setup();
    const userId = await seedMember("type-member-and-attendee@example.test");
    await env.DB.prepare(
      `INSERT INTO event_participants (id, event_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, ?, 'attendee', 'active', datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), eventId, userId)
      .run();

    const memberFiltered = await listUsers("type=member&q=type-member-and-attendee@example.test");
    expect(memberFiltered.users.map((u) => u.email)).toEqual(["type-member-and-attendee@example.test"]);

    const attendeeFiltered = await listUsers("type=event_attendee&q=type-member-and-attendee@example.test");
    expect(attendeeFiltered.users).toEqual([]);

    const unfiltered = await listUsers("q=type-member-and-attendee@example.test");
    expect(unfiltered.users[0].type).toBe("member");
  });

  it("returns 400 for an unrecognized type value", async () => {
    await setup();

    const response = await app.fetch(
      adminRequest("/api/v1/users?type=bogus", "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("with no type filter, returns users of every type", async () => {
    const { eventId } = await setup();
    await seedMember("type-all-member@example.test");
    await seedEventParticipant(eventId, "type-all-attendee@example.test");
    await seedUser(env.DB, "type-all-contact@example.test");

    const data = await listUsers("q=type-all-&limit=10");
    const byEmail = Object.fromEntries(data.users.map((u) => [u.email, u.type]));
    expect(byEmail["type-all-member@example.test"]).toBe("member");
    expect(byEmail["type-all-attendee@example.test"]).toBe("event_attendee");
    expect(byEmail["type-all-contact@example.test"]).toBe("contact_only");
  });

  it("lists a user with two identities exactly once, and the total count matches without identity-join fan-out", async () => {
    await setup();
    const userId = await seedUser(env.DB, "type-multi-org@example.test");
    const orgAId = crypto.randomUUID();
    const orgBId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(orgAId, "Org A", "org a"),
      env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      ).bind(orgBId, "Org B", "org b"),
    ]);
    const { getOrCreateOrganizationMemberAggregate } =
      await import("../functions/_lib/services/membership/memberships");
    const { buildCreateIdentityStatement } = await import("../functions/_lib/services/membership/identities");
    const now = new Date().toISOString();
    await getOrCreateOrganizationMemberAggregate(env.DB, orgAId, "A", now);
    await getOrCreateOrganizationMemberAggregate(env.DB, orgBId, "B", now);
    const { statement: repA } = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: orgAId,
      source: "staff",
      startImmediately: true,
      now,
    });
    const { statement: repB } = await buildCreateIdentityStatement(env.DB, {
      userId,
      organizationId: orgBId,
      source: "staff",
      startImmediately: true,
      now,
    });
    await env.DB.batch([repA, repB]);

    const data = await listUsers("type=member&q=type-multi-org@example.test");
    expect(data.users.filter((u) => u.email === "type-multi-org@example.test")).toHaveLength(1);
  });

  it("rejects an unrecognized sort value through the shared list contract", async () => {
    await setup();
    await seedUser(env.DB, "sort-fallback@example.test");

    const response = await app.fetch(
      adminRequest("/api/v1/users?q=sort-fallback@example.test&sort=not_a_real_column", "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(400);
    const data = (await response.json()) as { error: { code: string } };
    expect(data.error.code).toBe("VALIDATION_ERROR");
  });

  it("P6M-P2-08: a valid allowlisted ?sort= value is honored (ascending by email)", async () => {
    await setup();
    await seedUser(env.DB, "sort-a@example.test");
    await seedUser(env.DB, "sort-b@example.test");

    const response = await app.fetch(
      adminRequest("/api/v1/users?q=sort-&sort=email", "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { users: Array<{ email: string }> };
    const emails = data.users.map((u) => u.email).filter((e) => e.startsWith("sort-"));
    expect(emails).toEqual(["sort-a@example.test", "sort-b@example.test"]);
  });
});
