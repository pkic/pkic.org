import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { formDetailResponseSchema } from "../assets/shared/schemas/form-management";
import { requireManagedEventForm } from "../functions/_lib/services/forms";
import { callApi } from "./helpers/app";
import { createAdminSession, createMcpSession } from "./helpers/auth";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";

const f = createEventScannerFixture();
const base = "/api/v1/events/scan-test/forms";
const strict = { maxRoundTrips: 1 };
const key = "budget-event-survey";
const formId = crypto.randomUUID();
const headers = () => ({ authorization: `Bearer ${f.token}` });

beforeEach(async () => {
  await f.setup();
  const at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO forms(id,key,scope_type,scope_ref,purpose,status,title,created_at,updated_at)
      VALUES(?,?,'event',?,'survey','active','Event survey',?,?)`).bind(formId, key, f.eventId, at, at),
    ...[false, true].map((archived) =>
      env.DB.prepare(`INSERT INTO form_fields
      (id,form_id,key,label,field_type,required,sort_order,created_at,updated_at,archived_at)
      VALUES(?,?,?,?, 'text',0,?,?,?,?)`).bind(
        crypto.randomUUID(),
        formId,
        archived ? "history" : "answer",
        archived ? "Historical answer" : "Answer",
        archived ? 1 : 0,
        at,
        at,
        archived ? at : null,
      ),
    ),
  ]);
});

describe("event form detail request batching", () => {
  it("includes live human authorization, event relationship, and archived editor fields in one call", async () => {
    const response = await callApi(env, `${base}/${key}`, { headers: headers() }, strict);
    expect(response.status).toBe(200);
    const detail = formDetailResponseSchema.parse(await response.json());
    expect(detail.form).toMatchObject({ id: formId, scope_ref: f.eventId });
    expect(detail.fields.map((field) => field.key)).toEqual(["answer", "history"]);
    expect(detail.fields[1].archivedAt).not.toBeNull();
    const head = await callApi(env, `${base}/${key}`, { method: "HEAD", headers: headers() }, strict);
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("does not disclose another event's form or a missing form", async () => {
    const otherEventId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO events(id,slug,name,timezone,settings_json,created_at,updated_at)
        VALUES(?,'other-event','Other event','UTC','{}',?,?)`).bind(
        otherEventId,
        new Date().toISOString(),
        new Date().toISOString(),
      ),
      env.DB.prepare("UPDATE forms SET scope_ref=? WHERE id=?").bind(otherEventId, formId),
    ]);
    for (const formKey of [key, "missing-form"]) {
      const response = await callApi(env, `${base}/${formKey}`, { headers: headers() }, strict);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: "FORM_NOT_FOUND" } });
    }
    const missing = await callApi(env, `/api/v1/events/missing-event/forms/${key}`, { headers: headers() }, strict);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "EVENT_NOT_FOUND" } });
  });

  it("allows an unowned event placement for reading but never as event-owned editing authority", async () => {
    await env.DB.batch([
      env.DB.prepare("UPDATE forms SET scope_type='global',scope_ref=NULL WHERE id=?").bind(formId),
      env.DB.prepare(`INSERT INTO form_placements(id,form_id,owner_group_id,context_type,context_ref,audience,active,created_at,updated_at)
        VALUES(?,?,NULL,'event',?,'survey',1,?,?)`).bind(
        crypto.randomUUID(),
        formId,
        f.eventId,
        new Date().toISOString(),
        new Date().toISOString(),
      ),
    ]);
    expect((await callApi(env, `${base}/${key}`, { headers: headers() }, strict)).status).toBe(200);
    const profile = profileD1Flow(env.DB);
    await expect(requireManagedEventForm(profile.db, f.eventId, key, { ownedOnly: true })).rejects.toMatchObject({
      status: 404,
      code: "FORM_NOT_FOUND",
    });
    expect(profile.summary().roundTrips).toBe(1);
    await env.DB.prepare("UPDATE form_placements SET owner_group_id=(SELECT id FROM groups LIMIT 1) WHERE form_id=?")
      .bind(formId)
      .run();
    const placement = await env.DB.prepare("SELECT owner_group_id FROM form_placements WHERE form_id=?")
      .bind(formId)
      .first<{ owner_group_id: string | null }>();
    expect(placement?.owner_group_id).toBeTruthy();
    expect((await callApi(env, `${base}/${key}`, { headers: headers() }, strict)).status).toBe(404);
  });

  it("refuses invalid credentials without D1 and retains nested-report and write authentication", async () => {
    for (const token of [null, "invalid"]) {
      const auth: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      for (const suffix of [key, `${key}/submissions`, `${key}/submissions/stats`]) {
        expect((await callApi(env, `${base}/${suffix}`, { headers: auth }, { maxRoundTrips: 0 })).status).toBe(401);
      }
      expect(
        (
          await callApi(
            env,
            `${base}/${key}`,
            {
              method: "PATCH",
              headers: { ...auth, "content-type": "application/json" },
              body: "{}",
            },
            { maxRoundTrips: 0 },
          )
        ).status,
      ).toBe(401);
    }
  });

  it("refuses a revoked session in the resource batch", async () => {
    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), f.operatorId)
      .run();
    expect((await callApi(env, `${base}/${key}`, { headers: headers() }, strict)).status).toBe(401);
  });

  it("does not serialize fields if event authority disappears before the read snapshot", async () => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("FROM events WHERE slug"),
      async () => {
        const at = new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?").bind(at, f.operatorId),
          env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?").bind(at, f.operatorId),
        ]);
      },
    );
    const response = await callApi({ ...env, DB: db }, `${base}/${key}`, { headers: headers() }, strict);
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("fields");
  });

  it("checks event permission before revealing whether the form exists", async () => {
    const token = await createAdminSession(env.DB, f.userId, crypto.randomUUID());
    for (const formKey of [key, "missing-form"]) {
      const response = await callApi(
        env,
        `${base}/${formKey}`,
        { headers: { authorization: `Bearer ${token}` } },
        strict,
      );
      expect(response.status).toBe(403);
    }
  });

  it.each([true, false])("preserves delegated scopes (event read allowed: %s)", async (allowed) => {
    const token = await createMcpSession(
      env.DB,
      { id: f.operatorId, email: `${f.operatorId}@example.test` },
      crypto.randomUUID(),
      allowed ? ["events:read"] : ["forms:read"],
    );
    const response = await callApi(env, `${base}/${key}`, {
      headers: { authorization: `Bearer ${token}`, "x-pkic-machine-auth": "mcp" },
    });
    expect(response.status).toBe(allowed ? 200 : 403);
  });
});
