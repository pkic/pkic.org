import { describe, expect, it, beforeEach } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { env } from "cloudflare:workers";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { createAdminSession } from "./helpers/auth";
import { sha256Hex } from "../functions/_lib/utils/crypto";
import { onRequestGet as getRegistration } from "../functions/api/v1/registrations/manage/[token]";
import { onRequestGet as getProposal } from "../functions/api/v1/proposals/manage/[token]";
import { onRequestPost as openRegistrationManage } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/open-manage";
import { getEventBySlug } from "../functions/_lib/services/events";
import { createRegistration, confirmRegistrationByToken } from "../functions/_lib/services/registrations";

describe("manage read endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("returns registration state for a valid manage token", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const registrationId = crypto.randomUUID();
    const token = "registration-token";
    const tokenHash = await sha256Hex(token);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
        VALUES ('${userId}', 'person@example.test', 'person@example.test', 'Pat', 'Lee', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO registrations (
          id, event_id, user_id, status, attendance_type, source_type,
          manage_token_hash, created_at, updated_at
        ) VALUES (
          '${registrationId}', '${eventId}', '${userId}', 'registered', 'virtual', 'direct',
          '${tokenHash}', datetime('now'), datetime('now')
        )
      `),
    ]);

    const response = await getRegistration(
      createContext(env, new Request(`https://app.test/api/v1/registrations/manage/${token}`), { token }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { registration: { id: string } };
    expect(payload.registration.id).toBe(registrationId);
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
    });
    await confirmRegistrationByToken(env.DB, {
      token: first.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const second = await createRegistration(env.DB, {
      event,
      userId: "user-2",
      attendanceType: "in_person",
      dayAttendance: [{ dayDate: "2026-12-01", attendanceType: "in_person" }],
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    const confirmedSecond = await confirmRegistrationByToken(env.DB, {
      token: second.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    const response = await getRegistration(
      createContext(env, new Request(`https://app.test/api/v1/registrations/manage/${confirmedSecond.manageToken}`), {
        token: confirmedSecond.manageToken,
      }),
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
    });

    const openResponse = await openRegistrationManage(
      createContext(
        env,
        new Request("https://app.test/api/v1/admin/events/pqc-2026/registrations/open-manage", {
          method: "POST",
          headers: {
            authorization: `Bearer ${adminToken}`,
            "cf-connecting-ip": "203.0.113.30",
            "user-agent": "admin-browser",
          },
        }),
        { eventSlug: "pqc-2026", registrationId: created.registration.id },
      ),
    );

    expect(openResponse.status).toBe(200);
    const { manageUrl } = (await openResponse.json()) as { manageUrl: string };
    const jwt = new URL(manageUrl).searchParams.get("token") as string;
    expect(jwt.split(".")).toHaveLength(3);

    const validResponse = await getRegistration(
      createContext(
        env,
        new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
          headers: {
            "cf-connecting-ip": "203.0.113.30",
            "user-agent": "admin-browser",
          },
        }),
        { token: jwt },
      ),
    );
    expect(validResponse.status).toBe(200);

    const wrongContextResponse = await getRegistration(
      createContext(
        env,
        new Request(`https://app.test/api/v1/registrations/manage/${jwt}`, {
          headers: {
            "cf-connecting-ip": "203.0.113.31",
            "user-agent": "admin-browser",
          },
        }),
        { token: jwt },
      ),
    );
    expect(wrongContextResponse.status).toBe(403);
    const body = (await wrongContextResponse.json()) as { error: { code: string } };
    expect(body.error.code).toBe("AUTH_INVALID");
  });

  it("returns proposal state for a valid manage token", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    const userId = crypto.randomUUID();
    const proposalId = crypto.randomUUID();
    const token = "proposal-token";
    const tokenHash = await sha256Hex(token);

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, normalized_email, first_name, last_name, biography, created_at, updated_at)
        VALUES ('${userId}', 'speaker@example.test', 'speaker@example.test', 'Sam', 'Taylor', 'Speaker bio with enough detail for testing.', datetime('now'), datetime('now'))
      `),
      env.DB.prepare(`
        INSERT INTO session_proposals (
          id, event_id, proposer_user_id, status, proposal_type, title, abstract,
          manage_token_hash, submitted_at, updated_at
        ) VALUES (
          '${proposalId}', '${eventId}', '${userId}', 'submitted', 'talk', 'Proposal title',
          'Proposal abstract text that is sufficiently long for test payload validation.',
          '${tokenHash}', datetime('now'), datetime('now')
        )
      `),
      env.DB.prepare(`
        INSERT INTO proposal_speakers (id, proposal_id, user_id, role, created_at)
        VALUES ('${crypto.randomUUID()}', '${proposalId}', '${userId}', 'proposer', datetime('now'))
      `),
    ]);

    const response = await getProposal(
      createContext(env, new Request(`https://app.test/api/v1/proposals/manage/${token}`), { token }),
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { proposal: { id: string }; speakers: Array<{ email: string }> };
    expect(payload.proposal.id).toBe(proposalId);
    expect(payload.speakers[0].email).toBe("speaker@example.test");
  });
});
