import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";
import { apiErrorPayloadSchema } from "../assets/shared/schemas/api-common";
import { formCreateResponseSchema, formsListResponseSchema } from "../assets/shared/schemas/form-management";
import { formPlacementCreateResponseSchema } from "../assets/shared/schemas/forms";
import type { DatabaseLike } from "../functions/_lib/types";

type Grant = {
  userId: string;
  grantId: string;
  token: string;
};

async function grant(permission: string, options: { contextType?: string; contextId?: string } = {}): Promise<Grant> {
  const userId = await insertUser(env.DB, `${permission.replace(/[^a-z]/gi, "-")}-${crypto.randomUUID()}@test.invalid`);
  const grantId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO permission_grants
       (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
  )
    .bind(grantId, userId, permission, options.contextType ?? null, options.contextId ?? null, userId)
    .run();
  return {
    userId,
    grantId,
    token: await createAdminSession(env.DB, userId, `${permission}-${crypto.randomUUID()}`),
  };
}

async function call(token: string, path: string, init: RequestInit = {}, db: DatabaseLike = env.DB): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return app.fetch(
    new Request(`https://app.test${path}`, { ...init, headers }),
    { ...env, DB: db } as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

function formBody(key: string, purpose: "survey" | "feedback" = "survey") {
  return JSON.stringify({
    key,
    purpose,
    title: "Authorization test form",
    description: "A form used by the canonical resource authorization tests.",
    fields: [],
  });
}

async function insertForm(options: {
  key: string;
  scopeType: "global" | "community";
  scopeRef: string | null;
  purpose?: "survey" | "feedback";
}): Promise<string> {
  const formId = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO forms
       (id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(
      formId,
      options.key,
      options.scopeType,
      options.scopeRef,
      options.purpose ?? "survey",
      "Seeded authorization form",
      "A form seeded for a mounted resource test.",
      now,
      now,
    )
    .run();
  return formId;
}

describe("canonical Forms resource authorization", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("separates global forms:read and forms:write capabilities", async () => {
    const reader = await grant("forms:read");
    const writer = await grant("forms:write");

    const list = await call(reader.token, "/api/v1/forms");
    expect(list.status).toBe(200);
    formsListResponseSchema.parse(await list.json());

    const readerCreate = await call(reader.token, "/api/v1/forms", {
      method: "POST",
      body: formBody(`read-only-${crypto.randomUUID()}`),
    });
    expect(readerCreate.status).toBe(403);
    expect(apiErrorPayloadSchema.parse(await readerCreate.json()).error.code).toBe("PERMISSION_REQUIRED");

    const writerList = await call(writer.token, "/api/v1/forms");
    expect(writerList.status).toBe(403);

    const key = `write-only-${crypto.randomUUID()}`;
    const writerCreate = await call(writer.token, "/api/v1/forms", {
      method: "POST",
      body: formBody(key, "feedback"),
    });
    expect(writerCreate.status).toBe(201);
    expect(formCreateResponseSchema.parse(await writerCreate.json()).key).toBe(key);
  });

  it("does not expose group-owned definitions through the global Forms resource", async () => {
    const reader = await grant("forms:read");
    const groupFormKey = `group-owned-${crypto.randomUUID()}`;
    await insertForm({
      key: groupFormKey,
      scopeType: "community",
      scopeRef: "20000000-0000-4000-8000-000000000001",
    });

    const list = await call(reader.token, "/api/v1/forms");
    expect(list.status).toBe(200);
    const listBody = formsListResponseSchema.parse(await list.json());
    expect(listBody.forms.some((form) => form.key === groupFormKey)).toBe(false);

    const detail = await call(reader.token, `/api/v1/forms/${groupFormKey}`);
    expect(detail.status).toBe(404);
    expect(apiErrorPayloadSchema.parse(await detail.json()).error.code).toBe("FORM_NOT_FOUND");
  });

  it("returns 404 for retired admin Forms paths", async () => {
    const reader = await grant("forms:read");
    expect((await call(reader.token, "/api/v1/admin/forms")).status).toBe(404);

    const { eventId } = await seedEventAndAdmin(env.DB);
    const eventReader = await grant("events:read", { contextType: "event", contextId: eventId });
    expect((await call(eventReader.token, "/api/v1/admin/events/pqc-2026/forms")).status).toBe(404);
  });

  it("rejects ownerless group and organization placement targets from the global Forms resource", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await grant("forms:write");
    const key = `placement-boundary-${crypto.randomUUID()}`;
    expect(
      (
        await call(writer.token, "/api/v1/forms", {
          method: "POST",
          body: formBody(key),
        })
      ).status,
    ).toBe(201);

    for (const contextType of ["group", "organization"] as const) {
      const response = await call(writer.token, `/api/v1/forms/${key}/placements`, {
        method: "POST",
        body: JSON.stringify({ contextType, contextRef: crypto.randomUUID(), audience: "member" }),
      });
      expect(response.status).toBe(400);
      expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("FORM_PLACEMENT_CONTEXT_UNSUPPORTED");
    }

    const eventPlacementResponse = await call(writer.token, `/api/v1/forms/${key}/placements`, {
      method: "POST",
      body: JSON.stringify({ contextType: "event", contextRef: eventId, audience: "attendee" }),
    });
    expect(eventPlacementResponse.status).toBe(201);
    const eventPlacement = formPlacementCreateResponseSchema.parse(await eventPlacementResponse.json()).placement;
    const retargetResponse = await call(writer.token, `/api/v1/forms/${key}/placements/${eventPlacement.id}`, {
      method: "PATCH",
      body: JSON.stringify({ contextType: "group", contextRef: crypto.randomUUID() }),
    });
    expect(retargetResponse.status).toBe(400);
    expect(apiErrorPayloadSchema.parse(await retargetResponse.json()).error.code).toBe(
      "FORM_PLACEMENT_CONTEXT_UNSUPPORTED",
    );
  });

  it("uses event-scoped events:read and events:write for the event Forms resource", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const unrelatedEventId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO events
         (id, slug, name, timezone, starts_at, ends_at, registration_mode, invite_limit_attendee, settings_json, created_at, updated_at)
       VALUES (?, 'unrelated-2026', 'Unrelated Event', 'UTC', NULL, NULL, 'invite_or_open', 5, '{}', datetime('now'), datetime('now'))`,
    )
      .bind(unrelatedEventId)
      .run();
    const reader = await grant("events:read", { contextType: "event", contextId: eventId });
    const writer = await grant("events:write", { contextType: "event", contextId: eventId });
    const unrelated = await grant("events:read", { contextType: "event", contextId: unrelatedEventId });

    const readPath = "/api/v1/events/pqc-2026/forms";
    const readerList = await call(reader.token, readPath);
    expect(readerList.status).toBe(200);
    formsListResponseSchema.parse(await readerList.json());

    const unrelatedList = await call(unrelated.token, readPath);
    expect(unrelatedList.status).toBe(403);

    const readerCreate = await call(reader.token, readPath, {
      method: "POST",
      body: formBody(`event-read-only-${crypto.randomUUID()}`),
    });
    expect(readerCreate.status).toBe(403);

    const writerCreate = await call(writer.token, readPath, {
      method: "POST",
      body: formBody(`event-write-${crypto.randomUUID()}`),
    });
    expect(writerCreate.status).toBe(201);
  });

  it("rolls back a global form create when forms:write is revoked before the guarded batch", async () => {
    const writer = await grant("forms:write");
    const key = `revoked-before-commit-${crypto.randomUUID()}`;
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(writer.grantId)
        .run(),
    );

    const response = await call(
      writer.token,
      "/api/v1/forms",
      {
        method: "POST",
        body: formBody(key),
      },
      racedDb,
    );
    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("FORM_AUTHORIZATION_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM forms WHERE key = ?", key)).toHaveLength(0);
  });

  it("rolls back an event form create when scoped events:write is revoked before the guarded batch", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const writer = await grant("events:write", { contextType: "event", contextId: eventId });
    const key = `event-revoked-before-commit-${crypto.randomUUID()}`;
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(writer.grantId)
        .run(),
    );

    const response = await call(
      writer.token,
      "/api/v1/events/pqc-2026/forms",
      {
        method: "POST",
        body: formBody(key, "feedback"),
      },
      racedDb,
    );
    expect(response.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("EVENT_FORM_AUTHORIZATION_CHANGED");
    expect(await queryAll(env.DB, "SELECT id FROM forms WHERE key = ?", key)).toHaveLength(0);
  });

  it("rolls back global placement create and update when forms:write is revoked", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const createWriter = await grant("forms:write");
    const createKey = `placement-create-race-${crypto.randomUUID()}`;
    expect(
      (
        await call(createWriter.token, "/api/v1/forms", {
          method: "POST",
          body: formBody(createKey),
        })
      ).status,
    ).toBe(201);
    const createRaceDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(createWriter.grantId)
        .run(),
    );
    const createResponse = await call(
      createWriter.token,
      `/api/v1/forms/${createKey}/placements`,
      {
        method: "POST",
        body: JSON.stringify({ contextType: "event", contextRef: eventId, audience: "attendee" }),
      },
      createRaceDb,
    );
    expect(createResponse.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await createResponse.json()).error.code).toBe("FORM_AUTHORIZATION_CHANGED");
    expect(
      await queryAll(
        env.DB,
        `SELECT placement.id
           FROM form_placements placement
           JOIN forms form ON form.id = placement.form_id
          WHERE form.key = ? AND placement.context_type = 'event' AND placement.context_ref = ?`,
        createKey,
        eventId,
      ),
    ).toHaveLength(0);

    const updateWriter = await grant("forms:write");
    const updateKey = `placement-update-race-${crypto.randomUUID()}`;
    await call(updateWriter.token, "/api/v1/forms", { method: "POST", body: formBody(updateKey) });
    const placementResponse = await call(updateWriter.token, `/api/v1/forms/${updateKey}/placements`, {
      method: "POST",
      body: JSON.stringify({ contextType: "event", contextRef: eventId, audience: "attendee" }),
    });
    const placement = formPlacementCreateResponseSchema.parse(await placementResponse.json()).placement;
    const updateRaceDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
        .bind(updateWriter.grantId)
        .run(),
    );
    const updateResponse = await call(
      updateWriter.token,
      `/api/v1/forms/${updateKey}/placements/${placement.id}`,
      { method: "PATCH", body: JSON.stringify({ audience: "reviewer" }) },
      updateRaceDb,
    );
    expect(updateResponse.status).toBe(409);
    expect(apiErrorPayloadSchema.parse(await updateResponse.json()).error.code).toBe("FORM_AUTHORIZATION_CHANGED");
    expect(
      await queryAll<{ audience: string }>(env.DB, "SELECT audience FROM form_placements WHERE id = ?", placement.id),
    ).toEqual([{ audience: "attendee" }]);
  });

  it("rolls back event form updates and removal when scoped events:write is revoked", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);

    for (const mutation of ["PATCH", "DELETE"] as const) {
      const writer = await grant("events:write", { contextType: "event", contextId: eventId });
      const key = `event-${mutation.toLowerCase()}-race-${crypto.randomUUID()}`;
      expect(
        (
          await call(writer.token, "/api/v1/events/pqc-2026/forms", {
            method: "POST",
            body: formBody(key, "feedback"),
          })
        ).status,
      ).toBe(201);
      const racedDb = mutateBeforeNextBatch(env.DB, () =>
        env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE id = ?")
          .bind(writer.grantId)
          .run(),
      );
      const response = await call(
        writer.token,
        `/api/v1/events/pqc-2026/forms/${key}`,
        mutation === "PATCH"
          ? { method: mutation, body: JSON.stringify({ title: "Unauthorized update" }) }
          : { method: mutation },
        racedDb,
      );
      expect(response.status).toBe(409);
      expect(apiErrorPayloadSchema.parse(await response.json()).error.code).toBe("EVENT_FORM_AUTHORIZATION_CHANGED");
      expect(
        await queryAll<{ status: string; title: string }>(env.DB, "SELECT status, title FROM forms WHERE key = ?", key),
      ).toEqual([{ status: "active", title: "Authorization test form" }]);
    }
  });
});
