import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, confirmRegistrationByToken } from "../functions/_lib/services/registrations";
import { issueDatabaseCapability } from "../functions/_lib/services/capability-links";
import { signAdminManageJwt } from "../functions/_lib/utils/jwt";
import app from "../functions/router";
import {
  registrationManageReadResponseSchema,
  registrationManageUpdateResponseSchema,
} from "../assets/shared/schemas/registration";

const signingSecret = "test-signing-secret";

function callApp(request: Request): Promise<Response> {
  return app.fetch(request, env as any, { passThroughOnException: () => {}, waitUntil: () => {} } as any);
}

describe("manage read endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("returns registration state for a valid manage token", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const linkSecret = "registration-link-secret";

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('${userId}', 'person@example.test', 'person@example.test', 'Pat', 'Lee', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, status, attendance_type, source_type,
          manage_link_secret, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', 'registered', 'virtual', 'direct',
          '${linkSecret}', datetime('now'), datetime('now')
        )
      `),
    ]);
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "registration_manage",
      resourceId: registrationId,
    });

    const response = await callApp(new Request(`https://app.test/api/v1/registrations/manage/${token}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    const payload = registrationManageReadResponseSchema.parse(await response.json());
    expect(payload.registration.id).toBe(registrationId);
    expect(payload.registration).not.toHaveProperty("manage_link_secret");
    expect(payload.registration).not.toHaveProperty("confirmation_link_secret");
    expect(payload.registration).not.toHaveProperty("transition_revision");
    expect(payload.registration).not.toHaveProperty("source_ref");
    expect(payload.event).toEqual({ id: eventId, slug: "pqc-2026", name: "PQC Conference 2026" });
    expect(payload.user).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("manageToken");
  });

  it("rejects the stored token hash when it is used as a manage token", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const token = "hashed-registration-token";
    const tokenHash = await sha256Hex(token);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('${userId}', 'hashed@example.test', 'hashed@example.test', 'Hash', 'Token', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, status, attendance_type, source_type,
          manage_link_secret, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', 'registered', 'in_person', 'direct',
          '${tokenHash}', datetime('now'), datetime('now')
        )
      `),
    ]);

    const response = await callApp(new Request(`https://app.test/api/v1/registrations/manage/${tokenHash}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("REGISTRATION_NOT_FOUND");
  });

  it("does not confirm a pending registration when the manage link is opened", async () => {
    await seedEventAndAdmin(env.DB);

    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('pending-user', 'pending@example.test', 'pending@example.test', 'Pending', 'User', datetime('now'), datetime('now'))
    `,
    ).run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId: "pending-user",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const response = await callApp(new Request(`https://app.test/api/v1/registrations/manage/${created.manageToken}`));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      registration: { id: string; status: string; isEmailVerified: boolean };
    };
    expect(payload.registration.id).toBe(created.registration.id);
    expect(payload.registration.status).toBe("pending_email_confirmation");
    expect(payload.registration.isEmailVerified).toBe(false);

    const [registration] = await queryAll<{ confirmed_at: string | null; confirmation_link_secret: string | null }>(
      env.DB,
      "SELECT confirmed_at, confirmation_link_secret FROM registrations WHERE id = ?",
      [created.registration.id],
    );
    expect(registration.confirmed_at).toBeNull();
    expect(registration.confirmation_link_secret).toBeTruthy();
  });

  it("returns confirmed registrations with day-specific waitlist state", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO event_days (id, event_id, day_date, label, in_person_capacity, sort_order, created_at, updated_at)
        VALUES ('day-1', '${eventId}', '2026-12-01', 'Day 1', 1, 10, datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES
          ('user-1', 'one@example.test', 'one@example.test', 'One', 'Attendee', datetime('now'), datetime('now')),
          ('user-2', 'two@example.test', 'two@example.test', 'Two', 'Attendee', datetime('now'), datetime('now'))
      `),
    ]);

    const event = await getEventBySlug(env.DB, "pqc-2026");

    const first = await createRegistration(env.DB, {
      event,
      userId: "user-1",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
      signingSecret: "test-signing-secret",
    });

    const response = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${confirmedSecond.manageToken}`),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      registration: { status: string };
      dayWaitlist: Array<{
        dayDate: string;
        status: string;
        priorityLane: string;
        offerExpiresAt: string | null;
      }>;
    };

    expect(payload.registration.status).toBe("registered");
    expect(payload.dayWaitlist).toEqual([
      {
        dayDate: "2026-12-01",
        status: "waiting",
        priorityLane: "general",
        offerExpiresAt: null,
      },
    ]);
  });

  it("enforces admin manage JWT IP and user-agent binding", async () => {
    await seedEventAndAdmin(env.DB);
    const admin = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE role = 'admin' LIMIT 1"))[0];
    const adminToken = await createAdminSession(env.DB, admin.id, "admin-manage-token");

    await env.DB.prepare(
      `
      INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('jwt-user', 'jwt-user@example.test', 'jwt-user@example.test', 'Jwt', 'User', datetime('now'), datetime('now'))
    `,
    ).run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId: "jwt-user",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
      signingSecret: "test-signing-secret",
    });

    const openResponse = await callApp(
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${created.registration.id}/access`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${adminToken}`,
          "cf-connecting-ip": "203.0.113.30",
          "user-agent": "admin-browser",
        },
      }),
    );

    expect(openResponse.status).toBe(200);
    const { manageUrl } = (await openResponse.json()) as { manageUrl: string };
    const jwt = new URL(manageUrl).searchParams.get("token") as string;
    expect(jwt.split(".")).toHaveLength(3);
    const claims = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      actor: string;
      sid: string;
    };
    expect(claims.actor).toBe(admin.id);
    expect(claims.sid).toBeTruthy();

    const validResponse = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: {
          "cf-connecting-ip": "203.0.113.30",
          "user-agent": "admin-browser",
        },
      }),
    );
    expect(validResponse.status, JSON.stringify(await validResponse.clone().json())).toBe(200);

    const updateResponse = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.30",
          "user-agent": "admin-browser",
        },
        body: JSON.stringify({ action: "update", firstName: "Admin edited" }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    const updatePayload = registrationManageUpdateResponseSchema.parse(await updateResponse.clone().json());
    expect(updatePayload).toEqual({ success: true, emailChanged: false });
    expect(updatePayload).not.toHaveProperty("registration");
    const [audit] = await queryAll<{ actor_type: string; actor_id: string }>(
      env.DB,
      `SELECT actor_type, actor_id
       FROM audit_log
       WHERE entity_id = ? AND action = 'self_service_update'
       ORDER BY created_at DESC LIMIT 1`,
      [created.registration.id],
    );
    expect(audit).toEqual({ actor_type: "admin", actor_id: admin.id });

    const wrongContextResponse = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: {
          "cf-connecting-ip": "203.0.113.31",
          "user-agent": "admin-browser",
        },
      }),
    );
    expect(wrongContextResponse.status).toBe(403);
    const body = (await wrongContextResponse.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");

    await env.DB.prepare("UPDATE sessions SET revoked_at = datetime('now') WHERE id = ?").bind(claims.sid).run();
    const revokedSessionGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "admin-browser" },
      }),
    );
    expect(revokedSessionGet.status).toBe(401);

    const revokedSessionPatch = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.30",
          "user-agent": "admin-browser",
        },
        body: JSON.stringify({ action: "update", firstName: "Should fail" }),
      }),
    );
    expect(revokedSessionPatch.status).toBe(401);

    const revokedSessionHeadshot = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}/headshot`, {
        method: "PUT",
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "admin-browser" },
      }),
    );
    expect(revokedSessionHeadshot.status).toBe(401);

    // Restore only the fixture session so the following assertions isolate
    // account deactivation as a separate invalidation mechanism.
    await env.DB.prepare("UPDATE sessions SET revoked_at = NULL WHERE id = ?").bind(claims.sid).run();

    await env.DB.prepare("UPDATE users SET active = 0 WHERE id = ?").bind(admin.id).run();

    const deactivatedGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "admin-browser" },
      }),
    );
    expect(deactivatedGet.status).toBe(401);

    const deactivatedPatch = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.30",
          "user-agent": "admin-browser",
        },
        body: JSON.stringify({ action: "update", firstName: "Should fail" }),
      }),
    );
    expect(deactivatedPatch.status).toBe(401);

    const deactivatedHeadshot = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}/headshot`, {
        method: "PUT",
        headers: { "cf-connecting-ip": "203.0.113.30", "user-agent": "admin-browser" },
      }),
    );
    expect(deactivatedHeadshot.status).toBe(401);
  });

  it("rechecks the original event permissions for a scoped admin manage JWT", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [globalAdmin] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const scopedAdminId = crypto.randomUUID();
    const registrationUserId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(scopedAdminId, "scoped-admin@example.test", "scoped-admin@example.test"),
      env.DB.prepare(
        `INSERT INTO users (id, email, normalized_email, first_name, last_name, role, active, created_at, updated_at)
         VALUES (?, ?, ?, 'Managed', 'Attendee', 'user', 1, datetime('now'), datetime('now'))`,
      ).bind(registrationUserId, "managed-attendee@example.test", "managed-attendee@example.test"),
      env.DB.prepare(
        `INSERT INTO registrations (
           id, event_id, user_id, status, attendance_type, source_type,
           manage_link_secret, created_at, updated_at
         ) VALUES (?, ?, ?, 'registered', 'virtual', 'direct', ?, datetime('now'), datetime('now'))`,
      ).bind(registrationId, eventId, registrationUserId, crypto.randomUUID()),
      ...(["events:read", "events:write", "events:manage", "donations:read"] as const).map((permission) =>
        env.DB.prepare(
          `INSERT INTO permission_grants
             (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        ).bind(
          crypto.randomUUID(),
          scopedAdminId,
          permission,
          permission === "donations:read" ? null : "event",
          permission === "donations:read" ? null : eventId,
          globalAdmin.id,
        ),
      ),
    ]);

    const scopedAdminToken = await createAdminSession(env.DB, scopedAdminId, "scoped-admin-manage-token");
    const openResponse = await callApp(
      new Request(`https://app.test/api/v1/events/pqc-2026/registrations/${registrationId}/access`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${scopedAdminToken}`,
          "cf-connecting-ip": "203.0.113.40",
          "user-agent": "scoped-admin-browser",
        },
      }),
    );
    expect(openResponse.status).toBe(200);
    const { manageUrl } = (await openResponse.json()) as { manageUrl: string };
    const jwt = new URL(manageUrl).searchParams.get("token") as string;

    const validGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": "scoped-admin-browser" },
      }),
    );
    expect(validGet.status).toBe(200);

    const [iphash, uahash] = await Promise.all([sha256Hex("203.0.113.40"), sha256Hex("scoped-admin-browser")]);
    const wrongEventJwt = await signAdminManageJwt(signingSecret, {
      sub: registrationId,
      actor: scopedAdminId,
      sid: (await queryAll<{ id: string }>(env.DB, "SELECT id FROM sessions WHERE user_id = ?", scopedAdminId))[0].id,
      event: "different-event",
      iphash,
      uahash,
      ttlSeconds: 300,
    });
    const wrongEventGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${wrongEventJwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": "scoped-admin-browser" },
      }),
    );
    expect(wrongEventGet.status).toBe(401);

    await env.DB.prepare(
      "UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ? AND permission = 'events:write'",
    )
      .bind(scopedAdminId)
      .run();

    const readOnlyGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": "scoped-admin-browser" },
      }),
    );
    expect(readOnlyGet.status).toBe(200);

    const revokedPatch = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "cf-connecting-ip": "203.0.113.40",
          "user-agent": "scoped-admin-browser",
        },
        body: JSON.stringify({ action: "update", firstName: "Should fail" }),
      }),
    );
    expect(revokedPatch.status).toBe(403);

    const revokedHeadshot = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}/headshot`, {
        method: "PUT",
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": "scoped-admin-browser" },
      }),
    );
    expect(revokedHeadshot.status).toBe(403);

    await env.DB.prepare(
      "UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ? AND permission = 'events:read'",
    )
      .bind(scopedAdminId)
      .run();

    const revokedGet = await callApp(
      new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
        headers: { "cf-connecting-ip": "203.0.113.40", "user-agent": "scoped-admin-browser" },
      }),
    );
    expect(revokedGet.status).toBe(403);
  });

  it("returns proposal state for a valid manage token", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const linkSecret = "proposal-link-secret";

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, biography, created_at, updated_at)
        VALUES ('${userId}', 'speaker@example.test', 'speaker@example.test', 'Sam', 'Taylor', 'Speaker bio with enough detail for testing.', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO session_proposals (
          id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          manage_link_secret, submitted_at, updated_at
        ) VALUES (
          '${proposalId}', '${eventId}', '${userId}', 'submitted', 'talk', 'Proposal title',
          'Proposal abstract text that is sufficiently long for test payload validation.',
          '${linkSecret}', datetime('now'), datetime('now')
        )
      `),
      env.DB.prepare(`
        INSERT INTO proposal_speakers (id, proposal_id, user_id, role, created_at)
        VALUES ('${crypto.randomUUID()}', '${proposalId}', '${userId}', 'proposer', datetime('now'))
      `),
    ]);
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "proposal_manage",
      resourceId: proposalId,
    });

    const response = await callApp(new Request(`https://app.test/api/v1/proposals/manage/${token}`));

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      proposal: { id: string; manage_link_secret?: string };
      speakers: Array<{ email: string }>;
    };
    expect(payload.proposal.id).toBe(proposalId);
    expect(payload.proposal.manage_link_secret).toBeUndefined();
    expect(payload.speakers[0].email).toBe("speaker@example.test");
  });

  it("lets proposers update session type and presentation role without changing ownership", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    await env.DB.prepare("UPDATE events SET settings_json = ? WHERE id = ?")
      .bind(
        JSON.stringify({
          proposal: {
            sessionTypes: [
              { label: "talk", requiresPresentation: true },
              { label: "Ask Me Anything", requiresPresentation: false },
            ],
          },
        }),
        eventId,
      )
      .run();

    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const linkSecret = "proposal-update-link-secret";

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, biography, created_at, updated_at)
        VALUES ('${userId}', 'panel-lead@example.test', 'panel-lead@example.test', 'Panel', 'Lead', 'Speaker bio with enough detail for testing.', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO session_proposals (
          id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          details_json, manage_link_secret, submitted_at, updated_at
        ) VALUES (
          '${proposalId}', '${eventId}', '${userId}', 'submitted', 'talk', 'Proposal title',
          'Proposal abstract text that is sufficiently long for test payload validation.',
          '{"existing":"preserved"}', '${linkSecret}', datetime('now'), datetime('now')
        )
      `),
      env.DB.prepare(`
        INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
        VALUES ('${crypto.randomUUID()}', '${proposalId}', '${userId}', 'proposer', 'confirmed', datetime('now'))
      `),
    ]);
    const token = await issueDatabaseCapability({
      db: env.DB,
      signingSecret,
      purpose: "proposal_manage",
      resourceId: proposalId,
    });

    const updateResponse = await callApp(
      new Request(`https://app.test/api/v1/proposals/manage/${token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", proposalType: "ask me anything" }),
      }),
    );
    expect(updateResponse.status).toBe(200);
    await expect(updateResponse.json()).resolves.toMatchObject({
      proposal: { proposal_type: "Ask Me Anything", details: { existing: "preserved" } },
    });

    const unsupportedType = await callApp(
      new Request(`https://app.test/api/v1/proposals/manage/${token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", proposalType: "unconfigured session" }),
      }),
    );
    expect(unsupportedType.status).toBe(400);
    await expect(unsupportedType.json()).resolves.toMatchObject({ error: { code: "PROPOSAL_TYPE_NOT_ALLOWED" } });

    const emptyUpdate = await callApp(
      new Request(`https://app.test/api/v1/proposals/manage/${token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update" }),
      }),
    );
    expect(emptyUpdate.status).toBe(400);

    const ambiguousWithdrawal = await callApp(
      new Request(`https://app.test/api/v1/proposals/manage/${token}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "withdraw", title: "Do not apply this title" }),
      }),
    );
    expect(ambiguousWithdrawal.status).toBe(400);

    const speakerResponse = await callApp(
      new Request(`https://app.test/api/v1/proposals/manage/${token}/speakers/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "moderator" }),
      }),
    );
    expect(speakerResponse.status).toBe(200);

    const rows = await queryAll<{ proposal_type: string; role: string }>(
      env.DB,
      `SELECT sp.proposal_type, ps.role
       FROM session_proposals sp
       JOIN proposal_speakers ps ON ps.proposal_id = sp.id
       WHERE sp.id = ? AND ps.user_id = ?`,
      [proposalId, userId],
    );
    expect(rows[0]).toEqual({ proposal_type: "Ask Me Anything", role: "moderator" });
  });
});
