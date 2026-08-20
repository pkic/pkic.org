/**
 * application-stage-machine.test.ts
 *
 * application stage transitions, communications, and internal
 * notes via the admin endpoints (functions/api/v1/admin/applications/).
 */
import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";

function request(token: string, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createApplication(overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO member_applications
       (id, applicant_email, applicant_name, organization_name, organization_domain, membership_category,
        status, stage, stage_entered_at, manage_token_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'), datetime('now'))`,
  )
    .bind(
      id,
      (overrides.applicant_email as string) ?? "applicant@example.test",
      (overrides.applicant_name as string) ?? "Applicant Name",
      (overrides.organization_name as string) ?? "Example Org",
      (overrides.organization_domain as string) ?? "example.test",
      (overrides.membership_category as string) ?? "F",
      (overrides.status as string) ?? "pending",
      (overrides.stage as string) ?? "pending",
      crypto.randomUUID(),
    )
    .run();
  return { id };
}

describe("Application stage machine, communications, notes", () => {
  let adminToken: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    const adminRow = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0];
    adminToken = await createAdminSession(env.DB, adminRow.id, "app-stage-admin-token");
  });

  it("transitions pending -> in_review and records a member_application_events row", async () => {
    const { id } = await createApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ stage: string; status: string }>(
      env.DB,
      "SELECT stage, status FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].stage).toBe("in_review");
    expect(rows[0].status).toBe("in_review");

    const events = await queryAll(env.DB, "SELECT * FROM member_application_events WHERE application_id = ?", id);
    expect(events).toHaveLength(1);
  });

  it("compare-and-set: two concurrent transitions from the same stage produce exactly one success and one 409, with exactly one event row", async () => {
    const { id } = await createApplication();

    const [first, second] = await Promise.all([
      call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ toStage: "in_review" }),
      }),
      call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ toStage: "in_review" }),
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const rows = await queryAll<{ stage: string; status: string }>(
      env.DB,
      "SELECT stage, status FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].stage).toBe("in_review");
    expect(rows[0].status).toBe("in_review");

    const events = await queryAll(env.DB, "SELECT * FROM member_application_events WHERE application_id = ?", id);
    expect(events).toHaveLength(1);
  });

  it("rejects an invalid transition (pending -> ec_review)", async () => {
    const { id } = await createApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "ec_review" }),
    });
    expect(response.status).toBe(409);
  });

  it("requires a valid on_hold subtype when moving to on_hold, and queues the matching email", async () => {
    const { id } = await createApplication({ stage: "in_review", status: "in_review" });

    const missingSubtype = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "on_hold" }),
    });
    expect(missingSubtype.status).toBe(422);

    const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "on_hold", onHoldSubtype: "request_org_email" }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ stage: string; on_hold_subtype: string }>(
      env.DB,
      "SELECT stage, on_hold_subtype FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].stage).toBe("on_hold");
    expect(rows[0].on_hold_subtype).toBe("request_org_email");

    const outbox = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE template_key = 'application-hold-org-email'",
    );
    expect(outbox).toHaveLength(1);
  });

  it("rolls back the transition, event, and audit when its outbox insert fails", async () => {
    const { id } = await createApplication({ stage: "in_review", status: "in_review" });
    await env.DB.prepare(
      `CREATE TRIGGER fail_stage_email
       BEFORE INSERT ON email_outbox
       WHEN NEW.template_key = 'application-hold-org-email'
       BEGIN
         SELECT RAISE(ABORT, 'forced stage email failure');
       END`,
    ).run();

    try {
      const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ toStage: "on_hold", onHoldSubtype: "request_org_email" }),
      });
      expect(response.status).toBe(500);

      const [application] = await queryAll<{ stage: string; status: string }>(
        env.DB,
        "SELECT stage, status FROM member_applications WHERE id = ?",
        id,
      );
      expect(application).toEqual({ stage: "in_review", status: "in_review" });
      expect(
        await queryAll(env.DB, "SELECT id FROM member_application_events WHERE application_id = ?", id),
      ).toHaveLength(0);
      expect(
        await queryAll(
          env.DB,
          "SELECT id FROM audit_log WHERE entity_type = 'member_application' AND entity_id = ?",
          id,
        ),
      ).toHaveLength(0);
    } finally {
      await env.DB.prepare("DROP TRIGGER fail_stage_email").run();
    }
  });

  it("supports the on_hold -> in_review back-transition and clears on_hold_subtype", async () => {
    const { id } = await createApplication({ stage: "on_hold", status: "on_hold" });
    await env.DB.prepare("UPDATE member_applications SET on_hold_subtype = 'request_authority' WHERE id = ?")
      .bind(id)
      .run();

    const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    expect(response.status).toBe(200);

    const rows = await queryAll<{ stage: string; on_hold_subtype: string | null }>(
      env.DB,
      "SELECT stage, on_hold_subtype FROM member_applications WHERE id = ?",
      id,
    );
    expect(rows[0].stage).toBe("in_review");
    expect(rows[0].on_hold_subtype).toBeNull();
  });

  it("a terminal stage (declined) has no further transitions", async () => {
    const { id } = await createApplication({ stage: "declined", status: "declined" });
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    expect(response.status).toBe(409);
  });

  it("sends a communication, records it, and does not create a stage transition event", async () => {
    const { id } = await createApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/communications`, {
      method: "POST",
      body: JSON.stringify({ subject: "Following up", body: "Please send more info." }),
    });
    expect(response.status).toBe(201);

    const comms = await queryAll<{ kind: string; subject: string }>(
      env.DB,
      "SELECT kind, subject FROM application_communications WHERE application_id = ?",
      id,
    );
    expect(comms).toHaveLength(1);
    expect(comms[0].kind).toBe("communication");
    expect(comms[0].subject).toBe("Following up");

    const outbox = await queryAll(
      env.DB,
      "SELECT id FROM email_outbox WHERE recipient_email = 'applicant@example.test'",
    );
    expect(outbox.length).toBeGreaterThan(0);
  });

  it("adds an internal note that never queues an email", async () => {
    const { id } = await createApplication();
    const response = await call(adminToken, `/api/v1/admin/applications/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: "Internal-only observation." }),
    });
    expect(response.status).toBe(201);

    const notes = await queryAll<{ kind: string }>(
      env.DB,
      "SELECT kind FROM application_communications WHERE application_id = ?",
      id,
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].kind).toBe("note");

    const outbox = await queryAll(env.DB, "SELECT id FROM email_outbox");
    expect(outbox).toHaveLength(0);
  });

  it("GET detail returns events, communications, and notes together", async () => {
    const { id } = await createApplication();
    await call(adminToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    await call(adminToken, `/api/v1/admin/applications/${id}/notes`, {
      method: "POST",
      body: JSON.stringify({ body: "note" }),
    });

    const response = await call(adminToken, `/api/v1/admin/applications/${id}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: unknown[]; communications: unknown[] };
    expect(body.events).toHaveLength(1);
    expect(body.communications).toHaveLength(1);
  });

  it("GET list filters by stage", async () => {
    await createApplication({ stage: "pending", status: "pending" });
    const { id: reviewId } = await createApplication({
      stage: "in_review",
      status: "in_review",
      applicant_email: "second@example.test",
    });

    const response = await call(adminToken, "/api/v1/admin/applications?stage=in_review");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { applications: Array<{ id: string }> };
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].id).toBe(reviewId);
  });

  it("a plain user with no staff role cannot access admin application endpoints", async () => {
    const { id } = await createApplication();
    const userId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
       VALUES (?, 'plain@example.test', 'plain@example.test', 'user', 1, datetime('now'), datetime('now'))`,
    )
      .bind(userId)
      .run();
    const staffToken = await createAdminSession(env.DB, userId, "plain-user-token");

    const response = await call(staffToken, `/api/v1/admin/applications/${id}/stage`, {
      method: "PATCH",
      body: JSON.stringify({ toStage: "in_review" }),
    });
    expect(response.status).toBe(401);
  });
});
