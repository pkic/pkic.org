import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseLike } from "../functions/_lib/types";
import { env } from "cloudflare:workers";
import { createContext, seedEventAndAdmin, queryAll } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { resetDb } from "./helpers/reset-db";
import { onRequestPatch as patchUser } from "../functions/api/v1/admin/users/[userId]/index";
import { onRequestPost as anonymizeUser } from "../functions/api/v1/admin/users/[userId]/anonymize";
import app from "../functions/router";
import { buildCreateIndividualMemberStatements } from "../functions/_lib/services/membership/memberships";
import { addRepresentative, insertOrganization, seedOrganizationAggregate } from "./helpers/membership";
import { signCapabilityToken } from "../functions/_lib/services/capability-links";
import { confirmRegistrationByToken, getRegistrationByManageToken } from "../functions/_lib/services/registrations";
import { updateAdminUser } from "../functions/_lib/services/admin-user-update";
import { anonymizeAdminUser } from "../functions/_lib/services/admin-user-anonymize";
import { gateNextBatch } from "./helpers/d1-batch-gate";

let adminToken: string;

async function setup() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminId = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0].id;
  adminToken = await createAdminSession(env.DB, adminId, "admin-session-token");
  return { adminId, eventId, env };
}

function adminRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedUser(_db: DatabaseLike, email: string): Promise<string> {
  const userId = crypto.randomUUID();
  await env.DB.prepare(
    `
    INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
    VALUES (?, ?, ?, 'Test', 'User', 'user', 1, datetime('now'), datetime('now'));
  `,
  )
    .bind(userId, email, email)
    .run();
  return userId;
}

// ── Deactivation / reactivation ────────────────────────────────────────────

describe("admin user deactivation", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("deactivates an active user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "target@example.test");

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }), { userId }),
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
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: true }), { userId }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { user: { active: boolean } };
    expect(data.user.active).toBe(true);
  });

  it("can update role and active together", async () => {
    await setup();
    const userId = await seedUser(env.DB, "combo@example.test");

    const response = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { role: "guest", active: false }), {
        userId,
      }),
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { user: { role: string; active: boolean } };
    expect(data.user.role).toBe("guest");
    expect(data.user.active).toBe(false);
  });

  it("updates profile biography and links", async () => {
    await setup();
    const userId = await seedUser(env.DB, "profile@example.test");

    const response = await patchUser(
      createContext(
        env,
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {
          biography: "Admin maintained speaker biography.",
          links: ["https://example.test/profile", "https://github.com/profile"],
        }),
        { userId },
      ),
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{ biography: string | null; links_json: string | null }>(
        env.DB,
        "SELECT biography, links_json FROM users WHERE id = ?",
        [userId],
      )
    )[0];
    expect(row.biography).toBe("Admin maintained speaker biography.");
    expect(JSON.parse(row.links_json ?? "[]")).toEqual(["https://example.test/profile", "https://github.com/profile"]);
  });

  it("persists profile edits through the full router pipeline (regression: a stale duplicate PATCH route previously shadowed this handler)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "router-profile@example.test");

    const response = await app.fetch(
      adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {
        firstName: "Router",
        lastName: "Tested",
        jobTitle: "QA Lead",
        biography: "Persisted via the real HTTP router, not a direct handler call.",
      }),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const row = (
      await queryAll<{
        first_name: string | null;
        last_name: string | null;
        job_title: string | null;
        biography: string | null;
      }>(env.DB, "SELECT first_name, last_name, job_title, biography FROM users WHERE id = ?", [userId])
    )[0];
    expect(row.first_name).toBe("Router");
    expect(row.last_name).toBe("Tested");
    expect(row.job_title).toBe("QA Lead");
    expect(row.biography).toBe("Persisted via the real HTTP router, not a direct handler call.");
  });

  it("refuses to deactivate the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      patchUser(
        createContext(env, adminRequest(`/api/v1/admin/users/${adminId}`, "PATCH", { active: false }), {
          userId: adminId,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("writes an audit log entry on deactivation", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-deact@example.test");

    await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: false }), { userId }),
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
        adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {
          email: "new-private@example.test",
          biography: "Sensitive private biography",
          links: ["https://private.example.test/profile"],
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
    expect(detailsJson).not.toContain("Sensitive private biography");
    expect(detailsJson).not.toContain("private.example.test");
    expect(JSON.parse(detailsJson)).toMatchObject({
      changedFields: { to: expect.arrayContaining(["email", "biography", "links"]) },
    });
  });

  it("sets and clears isEcMember (users.is_ec_member, consolidated migration 0035)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "ec-member@example.test");

    const setResponse = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { isEcMember: true }), { userId }),
    );
    expect(setResponse.status).toBe(200);
    const setData = (await setResponse.json()) as { user: { isEcMember: boolean } };
    expect(setData.user.isEcMember).toBe(true);

    const rowAfterSet = (
      await queryAll<{ is_ec_member: number }>(env.DB, "SELECT is_ec_member FROM users WHERE id = ?", [userId])
    )[0];
    expect(rowAfterSet.is_ec_member).toBe(1);

    const getResponse = await app.fetch(
      adminRequest(`/api/v1/admin/users/${userId}`, "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
    const getData = (await getResponse.json()) as { user: { isEcMember: boolean } };
    expect(getData.user.isEcMember).toBe(true);

    const clearResponse = await patchUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { isEcMember: false }), { userId }),
    );
    const clearData = (await clearResponse.json()) as { user: { isEcMember: boolean } };
    expect(clearData.user.isEcMember).toBe(false);

    const rowAfterClear = (
      await queryAll<{ is_ec_member: number }>(env.DB, "SELECT is_ec_member FROM users WHERE id = ?", [userId])
    )[0];
    expect(rowAfterClear.is_ec_member).toBe(0);
  });

  it("rejects an empty patch body (no fields provided)", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      patchUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", {}), { userId })),
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
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
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

  it("closes active organization relationships so redacted users disappear from rosters and counts", async () => {
    await setup();
    const userId = await seedUser(env.DB, "representative-to-anonymize@example.test");
    const organizationId = await insertOrganization(env.DB, "Anonymization Organization");
    const memberId = await seedOrganizationAggregate(env.DB, organizationId, "A");
    await addRepresentative(env.DB, memberId, userId);

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    expect(
      await queryAll(
        env.DB,
        "SELECT left_at IS NOT NULL AS closed FROM organization_representatives WHERE member_id = ? AND user_id = ?",
        [memberId, userId],
      ),
    ).toEqual([{ closed: 1 }]);
    expect(
      await queryAll(
        env.DB,
        "SELECT COUNT(*) AS total FROM organization_representatives WHERE member_id = ? AND left_at IS NULL",
        memberId,
      ),
    ).toEqual([{ total: 0 }]);
  });

  it("revokes all active sessions for the anonymized user", async () => {
    await setup();
    const userId = await seedUser(env.DB, "session-holder@example.test");

    // Give the target user an active session
    await createAdminSession(env.DB, userId, "target-user-token");

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

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
        `INSERT INTO auth_magic_links (id, user_id, token_hash, expires_at, created_at)
           VALUES (?, ?, ?, datetime('now', '+1 hour'), datetime('now'))`,
      ).bind(crypto.randomUUID(), userId, `magic-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO passkey_credentials
             (id, user_id, credential_id, public_key, sign_count, device_name, created_at)
           VALUES (?, ?, ?, 'public-key', 0, 'Personal security key', datetime('now'))`,
      ).bind(crypto.randomUUID(), userId, `credential-${crypto.randomUUID()}`),
      env.DB.prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, issued_at, expires_at)
           VALUES (?, ?, ?, datetime('now'), datetime('now', '+1 day'))`,
      ).bind(crypto.randomUUID(), userId, `refresh-${crypto.randomUUID()}`),
      env.DB.prepare(
        `UPDATE users SET pending_email = 'pending@example.test', pending_email_expires_at = datetime('now', '+1 day'),
                            pending_email_change_registration_id = ?,
                            role = 'admin', is_ec_member = 1
           WHERE id = ?`,
      ).bind(registrationId, userId),
    ]);

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    expect(await queryAll(env.DB, "SELECT id FROM user_emails WHERE user_id = ?", userId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM auth_magic_links WHERE user_id = ?", userId)).toHaveLength(0);
    expect(await queryAll(env.DB, "SELECT id FROM passkey_credentials WHERE user_id = ?", userId)).toHaveLength(0);
    expect(
      await queryAll(env.DB, "SELECT id FROM refresh_tokens WHERE user_id = ? AND revoked_at IS NULL", userId),
    ).toHaveLength(0);
    const [user] = await queryAll<{
      pending_email: string | null;
      role: string;
      is_ec_member: number;
    }>(env.DB, "SELECT pending_email, role, is_ec_member FROM users WHERE id = ?", userId);
    expect(user).toMatchObject({ pending_email: null, role: "user", is_ec_member: 0 });
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
  });

  it("durably queues deletion of the prior headshot while clearing its pointer", async () => {
    await setup();
    const userId = await seedUser(env.DB, "headshot-anon@example.test");
    const key = `headshots/${userId}/before-anonymize.jpg`;
    await env.DB.prepare("UPDATE users SET headshot_r2_key = ? WHERE id = ?").bind(key, userId).run();

    await anonymizeUser(
      createContext(
        { ...(env as any), SPEAKER_UPLOADS_BUCKET: undefined },
        adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"),
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
    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    // Second attempt should be rejected
    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });

  it("rolls back a stale admin update that loses to anonymization", async () => {
    const { adminId } = await setup();
    const userId = await seedUser(env.DB, "race-update@example.test");
    await env.DB.prepare("UPDATE users SET biography = ? WHERE id = ?").bind("Private biography", userId).run();

    const gate = gateNextBatch(env.DB);
    const staleUpdate = updateAdminUser(gate.db, { id: adminId, email: "admin@pkic.org", role: "admin" }, userId, {
      email: "restored@example.test",
      biography: "Stale restored biography",
      active: false,
    });
    await gate.reached;

    await anonymizeAdminUser(env.DB, { id: adminId, email: "admin@pkic.org", role: "admin" }, userId);
    gate.release();

    await expect(staleUpdate).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
    const [user] = await queryAll<{
      email: string;
      biography: string | null;
      pending_email: string | null;
      active: number;
      pii_redacted_at: string | null;
    }>(env.DB, "SELECT email, biography, pending_email, active, pii_redacted_at FROM users WHERE id = ?", userId);
    expect(user.email).toBe(`redacted-${userId}@anonymized.invalid`);
    expect(user.biography).toBeNull();
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
    const staleAnonymization = anonymizeAdminUser(
      gate.db,
      { id: adminId, email: "admin@pkic.org", role: "admin" },
      userId,
    );
    await gate.reached;

    await updateAdminUser(env.DB, { id: adminId, email: "admin@pkic.org", role: "admin" }, userId, {
      email: "race-winner@example.test",
      biography: "Winner biography",
    });
    gate.release();

    await expect(staleAnonymization).rejects.toMatchObject({ code: "ANONYMIZATION_CONFLICT" });
    const [user] = await queryAll<{
      email: string;
      biography: string | null;
      active: number;
      pii_redacted_at: string | null;
    }>(env.DB, "SELECT email, biography, active, pii_redacted_at FROM users WHERE id = ?", userId);
    expect(user).toEqual({
      email: "race-winner@example.test",
      biography: "Winner biography",
      active: 1,
      pii_redacted_at: null,
    });
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE entity_id = ? AND action = 'user_anonymized'", userId),
    ).toHaveLength(0);
  });

  it("refuses to anonymize the calling admin's own account", async () => {
    const { env, adminId } = await setup();

    await expect(
      anonymizeUser(
        createContext(env, adminRequest(`/api/v1/admin/users/${adminId}/anonymize`, "POST"), { userId: adminId }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns 404 for a non-existent user", async () => {
    const { env } = await setup();
    const userId = crypto.randomUUID();

    await expect(
      anonymizeUser(createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit log entry on anonymization", async () => {
    await setup();
    const userId = await seedUser(env.DB, "audit-anon@example.test");

    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

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

  it("does not allow an anonymized account to be repopulated or reactivated", async () => {
    await setup();
    const userId = await seedUser(env.DB, "cannot-restore@example.test");
    await anonymizeUser(
      createContext(env, adminRequest(`/api/v1/admin/users/${userId}/anonymize`, "POST"), { userId }),
    );

    await expect(
      patchUser(
        createContext(env, adminRequest(`/api/v1/admin/users/${userId}`, "PATCH", { active: true }), { userId }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_ANONYMIZED" });
  });
});

// ── Type filter (member vs. event-attendee vs. contact-only) ───────────────
// Computed from the existing `members`/`event_participants` tables.

describe("admin users list — type filter", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function seedMember(email: string): Promise<string> {
    const userId = await seedUser(env.DB, email);
    const { statements } = buildCreateIndividualMemberStatements(env.DB, userId, "H5", new Date().toISOString());
    await env.DB.batch(statements);
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
    eventParticipationCount: number;
  }

  async function listUsers(query: string): Promise<{ users: ListedUser[] }> {
    const response = await app.fetch(
      adminRequest(`/api/v1/admin/users?${query}`, "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );
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
  });

  it("classifies a user with direct event roles as an event attendee and counts distinct events", async () => {
    const { eventId } = await setup();
    await seedEventParticipant(eventId, "type-attendee@example.test", 2);

    const data = await listUsers("type=event_attendee&q=type-attendee@example.test");
    expect(data.users.map((u) => u.email)).toEqual(["type-attendee@example.test"]);
    expect(data.users[0].type).toBe("event_attendee");
    expect(data.users[0].eventParticipationCount).toBe(1);
  });

  it("classifies a bare user (no membership, no event participation) as 'contact_only'", async () => {
    await setup();
    await seedUser(env.DB, "type-contact@example.test");

    const data = await listUsers("type=contact_only&q=type-contact@example.test");
    expect(data.users.map((u) => u.email)).toEqual(["type-contact@example.test"]);
    expect(data.users[0].type).toBe("contact_only");
    expect(data.users[0].eventParticipationCount).toBe(0);
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
      adminRequest("/api/v1/admin/users?type=bogus", "GET"),
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

  it("lists a user representing two organizations exactly once, and the total count matches (regression: unscoped organization_representatives join previously fanned out one row per represented organization)", async () => {
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
    const { buildAddRepresentativeStatement } = await import("../functions/_lib/services/membership/representatives");
    const now = new Date().toISOString();
    const memberA = await getOrCreateOrganizationMemberAggregate(env.DB, orgAId, "A", now);
    const memberB = await getOrCreateOrganizationMemberAggregate(env.DB, orgBId, "B", now);
    const { statement: repA } = buildAddRepresentativeStatement(env.DB, { memberId: memberA.id, userId, now });
    const { statement: repB } = buildAddRepresentativeStatement(env.DB, { memberId: memberB.id, userId, now });
    await env.DB.batch([repA, repB]);

    const data = await listUsers("type=member&q=type-multi-org@example.test");
    expect(data.users.filter((u) => u.email === "type-multi-org@example.test")).toHaveLength(1);
  });

  it("tolerates a malformed links_json row instead of 500ing the whole list (P10-01)", async () => {
    await setup();
    const userId = await seedUser(env.DB, "type-malformed-links@example.test");
    await env.DB.prepare("UPDATE users SET links_json = ? WHERE id = ?").bind("{not valid json", userId).run();

    const response = await app.fetch(
      adminRequest("/api/v1/admin/users?q=type-malformed-links@example.test", "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { users: Array<{ email: string; links: string[] }> };
    const user = data.users.find((u) => u.email === "type-malformed-links@example.test");
    expect(user?.links).toEqual([]);
  });

  it("rejects an unrecognized sort value through the shared list contract", async () => {
    await setup();
    await seedUser(env.DB, "sort-fallback@example.test");

    const response = await app.fetch(
      adminRequest("/api/v1/admin/users?q=sort-fallback@example.test&sort=not_a_real_column", "GET"),
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
      adminRequest("/api/v1/admin/users?q=sort-&sort=email", "GET"),
      env as any,
      { passThroughOnException: () => {}, waitUntil: () => {} } as any,
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { users: Array<{ email: string }> };
    const emails = data.users.map((u) => u.email).filter((e) => e.startsWith("sort-"));
    expect(emails).toEqual(["sort-a@example.test", "sort-b@example.test"]);
  });
});
