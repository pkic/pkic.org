import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { getEventBySlug } from "../functions/_lib/services/events";
import {
  createRegistration,
  confirmRegistrationByToken,
  updateRegistrationById,
} from "../functions/_lib/services/registrations";

let ADMIN_TOKEN = "event-admin-token";

function adminRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${ADMIN_TOKEN}`);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Request(`https://app.test${path}`, {
    ...init,
    headers,
  });
}

async function callAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    adminRequest(path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function setupAdmin(): Promise<{ baseEventId: string }> {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const adminRow = (
    await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1")
  )[0];
  ADMIN_TOKEN = await createAdminSession(env.DB, adminRow.id, ADMIN_TOKEN);
  return { baseEventId: eventId };
}

describe("admin event management endpoints", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lists events and creates a new event", async () => {
    await setupAdmin();

    const createResponse = await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({
        slug: "pqc-2027",
        name: "PQC 2027",
        timezone: "Europe/Amsterdam",
        startsAt: "2027-04-12T08:00:00.000Z",
        endsAt: "2027-04-14T17:00:00.000Z",
        registrationMode: "open",
        inviteLimitAttendee: 10,
        venue: "Amsterdam Congress Center",
        virtualUrl: "https://pkic.org/live/",
      }),
    });

    expect(createResponse.status).toBe(201);
    const createdPayload = (await createResponse.json()) as {
      event: { slug: string; settings: Record<string, unknown> };
    };
    expect(createdPayload.event.slug).toBe("pqc-2027");
    expect(createdPayload.event.settings.venue).toBe("Amsterdam Congress Center");

    const duplicateResponse = await callAdmin("/api/v1/admin/events", {
      method: "POST",
      body: JSON.stringify({
        slug: "pqc-2027",
        name: "PQC 2027 Duplicate",
        timezone: "Europe/Amsterdam",
        registrationMode: "open",
        inviteLimitAttendee: 10,
      }),
    });

    expect(duplicateResponse.status).toBe(409);
    const duplicatePayload = (await duplicateResponse.json()) as { error?: { code?: string } };
    expect(duplicatePayload.error?.code).toBe("SLUG_TAKEN");

    const listResponse = await callAdmin("/api/v1/admin/events");
    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as { events: Array<{ slug: string }> };
    expect(listPayload.events.map((event) => event.slug)).toEqual(expect.arrayContaining(["pqc-2026", "pqc-2027"]));
  });

  it("returns details and persists settings updates", async () => {
    await setupAdmin();

    const detailResponse = await callAdmin("/api/v1/admin/events/pqc-2026");
    expect(detailResponse.status).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      event: { slug: string; settings: Record<string, unknown> };
    };
    expect(detailPayload.event.slug).toBe("pqc-2026");

    const patchResponse = await callAdmin("/api/v1/admin/events/pqc-2026/settings", {
      method: "PATCH",
      body: JSON.stringify({
        name: "PQC Conference 2026 - Updated",
        venue: "The Hague Conference Center",
        virtualUrl: "https://pkic.org/live/pqc-2026/",
        userRetentionDays: 180,
        sessionTypes: ["talk", "panel"],
      }),
    });

    expect(patchResponse.status).toBe(200);
    const patchPayload = (await patchResponse.json()) as {
      success: boolean;
      event: {
        name: string;
        venue: string | null;
        user_retention_days: number | null;
        settings: Record<string, unknown>;
      };
    };
    expect(patchPayload.success).toBe(true);
    expect(patchPayload.event.name).toBe("PQC Conference 2026 - Updated");
    expect(patchPayload.event.settings.venue).toBe("The Hague Conference Center");
    expect(patchPayload.event.settings.virtualUrl).toBe("https://pkic.org/live/pqc-2026/");
    expect(patchPayload.event.user_retention_days).toBe(180);
    expect((patchPayload.event.settings.proposal as { sessionTypes?: string[] } | undefined)?.sessionTypes).toEqual([
      "talk",
      "panel",
    ]);
  });

  it("replaces event days and exposes permission grants", async () => {
    await setupAdmin();

    const daysResponse = await callAdmin("/api/v1/admin/events/pqc-2026/days", {
      method: "PUT",
      body: JSON.stringify({
        days: [
          {
            date: "2026-12-01",
            label: "Day 1",
            startTime: "09:00",
            endTime: "17:00",
            sortOrder: 0,
            attendanceOptions: [
              { value: "in_person", label: "In person", capacity: 30 },
              { value: "virtual", label: "Virtual" },
            ],
          },
          {
            date: "2026-12-02",
            label: "Day 2",
            startTime: "10:00",
            endTime: "16:00",
            sortOrder: 1,
            attendanceOptions: [{ value: "in_person", label: "In person", capacity: 20 }],
          },
        ],
      }),
    });

    expect(daysResponse.status).toBe(200);
    const daysPayload = (await daysResponse.json()) as {
      success: boolean;
      days: Array<{ date: string; label: string }>;
    };
    expect(daysPayload.success).toBe(true);
    expect(daysPayload.days.map((day) => day.date)).toEqual(["2026-12-01", "2026-12-02"]);

    const permissionResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        permission: "organizer",
      }),
    });

    expect(permissionResponse.status).toBe(201);
    const permissionPayload = (await permissionResponse.json()) as {
      permission: { user_email: string; permission: string };
    };
    expect(permissionPayload.permission.user_email).toBe("organizer@example.test");
    expect(permissionPayload.permission.permission).toBe("organizer");

    const duplicatePermissionResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions", {
      method: "POST",
      body: JSON.stringify({
        userEmail: "organizer@example.test",
        permission: "organizer",
      }),
    });

    expect(duplicatePermissionResponse.status).toBe(409);

    const permissionListResponse = await callAdmin("/api/v1/admin/events/pqc-2026/permissions");
    expect(permissionListResponse.status).toBe(200);
    const permissionListPayload = (await permissionListResponse.json()) as {
      permissions: Array<{ user_email: string; permission: string }>;
    };
    expect(permissionListPayload.permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_email: "organizer@example.test", permission: "organizer" }),
      ]),
    );
  });

  it("allows admin to reinstate a cancelled registration and rejects double-cancel", async () => {
    await setupAdmin();

    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, created_at, updated_at)
       VALUES ('user-reinstate', 'reinstate@example.test', 'reinstate@example.test', datetime('now'), datetime('now'))`,
    ).run();

    const event = await getEventBySlug(env.DB, "pqc-2026");
    const created = await createRegistration(env.DB, {
      event,
      userId: "user-reinstate",
      attendanceType: "virtual",
      sourceType: "direct",
      confirmationTtlHours: 48,
    });
    await confirmRegistrationByToken(env.DB, {
      token: created.confirmationToken as string,
      waitlistClaimWindowHours: 24,
    });

    // Cancel via the service (simulates attendee or earlier admin action)
    const cancelled = await updateRegistrationById(
      env.DB,
      { registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
      "admin:test",
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelled_at).not.toBeNull();

    // Double-cancel must still be rejected
    await expect(
      updateRegistrationById(
        env.DB,
        { registrationId: created.registration.id, action: "cancel", waitlistClaimWindowHours: 24 },
        "admin:test",
      ),
    ).rejects.toMatchObject({ code: "ALREADY_CANCELLED" });

    // Admin reinstates via the HTTP endpoint
    const reinstateResponse = await callAdmin(
      `/api/v1/admin/events/pqc-2026/registrations/${created.registration.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ action: "update", attendanceType: "virtual" }),
      },
    );
    expect(reinstateResponse.status).toBe(200);
    const reinstatePayload = (await reinstateResponse.json()) as { success: boolean; registration: { status: string } };
    expect(reinstatePayload.success).toBe(true);
    expect(reinstatePayload.registration.status).toBe("registered");

    const row = (
      await queryAll<{ cancelled_at: string | null }>(
        env.DB,
        "SELECT cancelled_at FROM registrations WHERE id = ?",
        created.registration.id,
      )
    )[0];
    expect(row.cancelled_at).toBeNull();
  });
});
