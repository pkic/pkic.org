import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  MEMBERSHIP_APPLICATION_FORM_KEY,
  membershipApplicationFormDefinitionResponseSchema,
  membershipApplicationFormDefinitionUpdateSchema,
} from "../assets/shared/schemas/membership-application-form";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import {
  getMembershipApplicationFormDefinition,
  updateMembershipApplicationFormDefinition,
} from "../functions/_lib/services/membership/application-form";
import { getGlobalFormByKey } from "../functions/_lib/services/forms";
import app from "../functions/router";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedMembershipApplicationForm } from "./helpers/member-applications";
import { resetDb } from "./helpers/reset-db";
import type { Permission } from "../assets/shared/schemas/permissions";
import type { FormFieldDefinition } from "../assets/shared/schemas/forms";

const DEFINITION_PATH = "/api/v1/members/applications/form/definition";

function request(token: string | null, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(`https://app.test${path}`, { ...init, headers });
}

async function call(token: string | null, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(
    request(token, path, init),
    env as any,
    { passThroughOnException: () => {}, waitUntil: () => {} } as any,
  );
}

async function createStaff(permission: Permission): Promise<{ id: string; token: string }> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, email, normalized_email, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'user', 1, datetime('now'), datetime('now'))`,
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`)
    .run();
  await env.DB.prepare(
    `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  )
    .bind(crypto.randomUUID(), id, permission, adminId)
    .run();
  return { id, token: await createAdminSession(env.DB, id, `application-form-${crypto.randomUUID()}`) };
}

function toFieldInputs(fields: FormFieldDefinition[]) {
  return fields.map(({ id, key, label, fieldType, required, options, optionSource, validation, sortOrder }) => ({
    id,
    key,
    label,
    fieldType,
    required,
    sortOrder,
    ...(options === null ? {} : { options }),
    ...(optionSource === null ? {} : { optionSource }),
    ...(validation === null ? {} : { validation }),
  }));
}

function policyFieldSemantics(fields: FormFieldDefinition[]) {
  return fields.map(({ updatedAt: _updatedAt, ...field }) => field);
}

let adminId: string;
let adminToken: string;

beforeEach(async () => {
  await resetDb();
  await seedEventAndAdmin(env.DB);
  await seedMembershipApplicationForm();
  adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0].id;
  adminToken = await createAdminSession(env.DB, adminId, `application-form-admin-${crypto.randomUUID()}`);
});

describe("membership application form definition", () => {
  it("keeps the public form projection available without staff authentication", async () => {
    const response = await call(null, "/api/v1/members/applications/form");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    await expect(response.json()).resolves.toMatchObject({
      categories: expect.any(Array),
      form: { key: MEMBERSHIP_APPLICATION_FORM_KEY },
    });
  });

  it("fails closed when the singleton has no exactly-one active installation placement", async () => {
    const [{ id: placementId }] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM form_placements WHERE form_id = (SELECT id FROM forms WHERE key = ?)",
      [MEMBERSHIP_APPLICATION_FORM_KEY],
    );
    await env.DB.prepare("UPDATE form_placements SET active = 0 WHERE id = ?").bind(placementId).run();
    expect(await getGlobalFormByKey(env.DB, MEMBERSHIP_APPLICATION_FORM_KEY)).toBeNull();
    await expect((await call(null, "/api/v1/members/applications/form")).json()).resolves.toMatchObject({ form: null });

    await env.DB.prepare("UPDATE form_placements SET active = 1 WHERE id = ?").bind(placementId).run();
    await env.DB.prepare(
      `INSERT INTO form_placements
         (id, form_id, owner_group_id, context_type, context_ref, audience, active, opens_at, closes_at, created_at, updated_at)
       VALUES (?, (SELECT id FROM forms WHERE key = ?), NULL, 'installation', NULL, 'alternate', 1, NULL, NULL, datetime('now'), datetime('now'))`,
    )
      .bind(crypto.randomUUID(), MEMBERSHIP_APPLICATION_FORM_KEY)
      .run();
    expect(await getGlobalFormByKey(env.DB, MEMBERSHIP_APPLICATION_FORM_KEY)).toBeNull();
  });

  it("uses the keyed form lookup for the public and staff definition reads", async () => {
    const plan = await queryAll<{ detail: string }>(
      env.DB,
      "EXPLAIN QUERY PLAN SELECT id FROM forms WHERE status = 'active' AND scope_type = 'global' AND key = ?",
      [MEMBERSHIP_APPLICATION_FORM_KEY],
    );
    expect(plan.map((row) => row.detail).join("\n")).toMatch(/SEARCH forms USING (?:COVERING )?INDEX/i);
  });

  it("removes the singleton definition from legacy admin form discovery and mutation routes", async () => {
    const list = await call(adminToken, "/api/v1/admin/forms?limit=50&offset=0");
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { forms: Array<{ key: string }>; page: { total: number } };
    expect(listBody.forms.map((form) => form.key)).not.toContain("membership-application");
    const [{ total }] = await queryAll<{ total: number }>(
      env.DB,
      "SELECT COUNT(*) AS total FROM forms WHERE key <> 'membership-application'",
    );
    expect(listBody.page.total).toBe(total);

    for (const [path, init] of [
      ["/api/v1/admin/forms/membership-application", {}],
      [
        "/api/v1/admin/forms/membership-application",
        { method: "PATCH", body: JSON.stringify({ title: "Legacy change" }) },
      ],
      ["/api/v1/admin/forms/membership-application", { method: "DELETE" }],
      ["/api/v1/admin/forms/membership-application/placements", {}],
      ["/api/v1/admin/forms/membership-application/placements", { method: "POST", body: JSON.stringify({}) }],
      [
        "/api/v1/admin/forms/membership-application/placements/00000000-0000-4000-8000-000000000000",
        { method: "PATCH", body: JSON.stringify({}) },
      ],
    ] satisfies Array<[string, RequestInit]>) {
      const response = await call(adminToken, path, init);
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "MEMBERSHIP_APPLICATION_FORM_DEFINITION_REQUIRED" },
      });
    }

    const create = await call(adminToken, "/api/v1/admin/forms", {
      method: "POST",
      body: JSON.stringify({
        key: "membership-application",
        purpose: "application",
        title: "Legacy duplicate",
      }),
    });
    expect(create.status).toBe(409);
  });

  it("exposes the editable definition only to a user-backed membership reader", async () => {
    const unauthenticated = await call(null, DEFINITION_PATH);
    expect(unauthenticated.status).toBe(401);

    const apiKey = await call(env.ADMIN_API_KEY ?? "test-admin-key", DEFINITION_PATH);
    expect(apiKey.status).toBe(403);
    await expect(apiKey.json()).resolves.toMatchObject({ error: { code: "USER_BACKED_ADMIN_REQUIRED" } });

    const reader = await createStaff("membership:read");
    const response = await call(reader.token, DEFINITION_PATH);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const definition = membershipApplicationFormDefinitionResponseSchema.parse(await response.json());
    expect(definition.form).toMatchObject({ key: "membership-application", purpose: "application" });
    expect(definition.fields).not.toHaveLength(0);
    expect(definition.fields.map((field) => field.key)).not.toEqual(
      expect.arrayContaining(["agrees_bylaws", "agrees_code_of_conduct", "agrees_ipr_policy", "warranted_authority"]),
    );
    expect(definition.policyFields).toHaveLength(4);
    expect(definition.policyFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "agrees_bylaws", fieldType: "boolean", required: true }),
        expect.objectContaining({ key: "agrees_code_of_conduct", fieldType: "boolean", required: true }),
        expect.objectContaining({ key: "agrees_ipr_policy", fieldType: "boolean", required: true }),
        expect.objectContaining({ key: "warranted_authority", fieldType: "boolean", required: true }),
      ]),
    );
    expect(definition.policyFields.every((field) => field.validation.requireTrue)).toBe(true);
  });

  it("keeps workflow policy fields immutable while allowing dynamic question edits", async () => {
    const initial = membershipApplicationFormDefinitionResponseSchema.parse(
      await (await call(adminToken, DEFINITION_PATH)).json(),
    );
    const reason = initial.fields.find((field) => field.key === "reason");
    expect(reason).toBeDefined();
    const dynamicFields = toFieldInputs(initial.fields).map((field) =>
      field.key === "reason" ? { ...field, label: "Why would you like to participate?" } : field,
    );

    const update = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: initial.form.updatedAt, fields: dynamicFields }),
    });
    expect(update.status).toBe(200);
    const updated = membershipApplicationFormDefinitionResponseSchema.parse(await update.json());
    expect(updated.fields.find((field) => field.key === "reason")?.label).toBe("Why would you like to participate?");
    expect(policyFieldSemantics(updated.policyFields)).toEqual(policyFieldSemantics(initial.policyFields));

    const reservedInjection = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: updated.form.updatedAt,
        fields: [
          ...toFieldInputs(updated.fields),
          { ...toFieldInputs([updated.policyFields[0]])[0], required: false, validation: {} },
        ],
      }),
    });
    expect(reservedInjection.status).toBe(400);

    const disguisedPolicyMutation = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: updated.form.updatedAt,
        fields: [
          ...toFieldInputs(updated.fields),
          {
            ...toFieldInputs([updated.policyFields[0]])[0],
            key: "replacement_policy_question",
            required: false,
            validation: {},
          },
        ],
      }),
    });
    expect(disguisedPolicyMutation.status).toBe(422);
    await expect(disguisedPolicyMutation.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_POLICY_FIELD_PROTECTED" },
    });
  });

  it("fails closed when a workflow policy field is deleted or weakened in D1", async () => {
    const [policy] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM form_fields WHERE form_id = (SELECT id FROM forms WHERE key = ?) AND key = 'agrees_bylaws'",
      [MEMBERSHIP_APPLICATION_FORM_KEY],
    );

    await env.DB.prepare("UPDATE form_fields SET required = 0 WHERE id = ?").bind(policy.id).run();
    const weakened = await call(adminToken, DEFINITION_PATH);
    expect(weakened.status).toBe(500);
    await expect(weakened.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_POLICY_FIELDS_INVALID" },
    });
    expect((await call(null, "/api/v1/members/applications/form")).status).toBe(500);

    await env.DB.prepare("UPDATE form_fields SET required = 1, archived_at = datetime('now') WHERE id = ?")
      .bind(policy.id)
      .run();
    const deleted = await call(adminToken, DEFINITION_PATH);
    expect(deleted.status).toBe(500);
    await expect(deleted.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_POLICY_FIELDS_INVALID" },
    });
  });

  it("preserves independent read and write permissions while atomically auditing an update", async () => {
    const reader = await createStaff("membership:read");
    const writer = await createStaff("membership:write");
    const definition = membershipApplicationFormDefinitionResponseSchema.parse(
      await (await call(reader.token, DEFINITION_PATH)).json(),
    );

    const readerWrite = await call(reader.token, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: definition.form.updatedAt, title: "Reader must not update" }),
    });
    expect(readerWrite.status).toBe(403);

    const writerRead = await call(writer.token, DEFINITION_PATH);
    expect(writerRead.status).toBe(403);

    const update = membershipApplicationFormDefinitionUpdateSchema.parse({
      expectedUpdatedAt: definition.form.updatedAt,
      title: "Membership application details",
    });
    const updatedResponse = await call(writer.token, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    expect(updatedResponse.status).toBe(200);
    const updated = membershipApplicationFormDefinitionResponseSchema.parse(await updatedResponse.json());
    expect(updated.form.title).toBe("Membership application details");
    expect(updated.form.updatedAt).not.toBe(definition.form.updatedAt);
    expect(
      await queryAll<{ actor_id: string; entity_id: string }>(
        env.DB,
        "SELECT actor_id, entity_id FROM audit_log WHERE action = 'membership_application_form_updated'",
      ),
    ).toEqual([{ actor_id: writer.id, entity_id: definition.form.id }]);

    const publicProjection = await call(null, "/api/v1/members/applications/form");
    await expect(publicProjection.json()).resolves.toMatchObject({ form: { title: "Membership application details" } });
  });

  it("rejects a stale definition revision without a partial update or audit row", async () => {
    const first = membershipApplicationFormDefinitionResponseSchema.parse(
      await (await call(adminToken, DEFINITION_PATH)).json(),
    );
    const updated = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: first.form.updatedAt, title: "First form title" }),
    });
    expect(updated.status).toBe(200);

    const stale = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: first.form.updatedAt, title: "Stale form title" }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: { code: "FORM_CHANGED" } });
    expect((await getMembershipApplicationFormDefinition(env.DB)).form.title).toBe("First form title");
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'membership_application_form_updated'"),
    ).toHaveLength(1);
  });

  it("intentionally takes the public form offline and restores it when status changes", async () => {
    const active = membershipApplicationFormDefinitionResponseSchema.parse(
      await (await call(adminToken, DEFINITION_PATH)).json(),
    );
    const inactiveResponse = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: active.form.updatedAt, status: "inactive" }),
    });
    expect(inactiveResponse.status).toBe(200);
    const inactive = membershipApplicationFormDefinitionResponseSchema.parse(await inactiveResponse.json());
    expect(inactive.form.status).toBe("inactive");
    await expect((await call(null, "/api/v1/members/applications/form")).json()).resolves.toMatchObject({ form: null });

    const restoredResponse = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({ expectedUpdatedAt: inactive.form.updatedAt, status: "active" }),
    });
    expect(restoredResponse.status).toBe(200);
    await expect((await call(null, "/api/v1/members/applications/form")).json()).resolves.toMatchObject({
      form: { key: "membership-application" },
    });
  });

  it("keeps archived fields out of later editor saves", async () => {
    const current = membershipApplicationFormDefinitionResponseSchema.parse(
      await (await call(adminToken, DEFINITION_PATH)).json(),
    );
    const field = current.fields.find((entry) => entry.key === "reason");
    expect(field).toBeDefined();
    const submissionId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, form_id, submitted_by_user_id, context_type, context_ref, status, submitted_at)
       VALUES (?, ?, NULL, 'membership', NULL, 'submitted', datetime('now'))`,
    )
      .bind(submissionId, current.form.id)
      .run();
    await env.DB.prepare(
      `INSERT INTO form_submission_answers (id, submission_id, field_id, field_key, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), submissionId, field!.id, field!.key, JSON.stringify("Historical answer"))
      .run();

    const archive = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: current.form.updatedAt,
        fields: toFieldInputs(current.fields.filter((entry) => entry.id !== field!.id)),
      }),
    });
    expect(archive.status).toBe(200);
    const afterArchive = membershipApplicationFormDefinitionResponseSchema.parse(await archive.json());
    expect(afterArchive.fields.map((entry) => entry.id)).not.toContain(field!.id);

    const archivedIdReuse = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: afterArchive.form.updatedAt,
        fields: [...toFieldInputs(afterArchive.fields), { ...toFieldInputs([field!])[0], key: "replacement_reason" }],
      }),
    });
    expect(archivedIdReuse.status).toBe(409);
    await expect(archivedIdReuse.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_FORM_FIELD_ARCHIVED" },
    });

    const archivedKeyReuse = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: afterArchive.form.updatedAt,
        fields: [...toFieldInputs(afterArchive.fields), { ...toFieldInputs([field!])[0], id: undefined }],
      }),
    });
    expect(archivedKeyReuse.status).toBe(409);
    await expect(archivedKeyReuse.json()).resolves.toMatchObject({
      error: { code: "MEMBERSHIP_APPLICATION_FORM_FIELD_ARCHIVED" },
    });

    const titleOnlyEditorSave = await call(adminToken, DEFINITION_PATH, {
      method: "PATCH",
      body: JSON.stringify({
        expectedUpdatedAt: afterArchive.form.updatedAt,
        title: "Updated without restoring history",
        fields: toFieldInputs(afterArchive.fields),
      }),
    });
    expect(titleOnlyEditorSave.status).toBe(200);
    expect(
      await queryAll<{ archived_at: string | null }>(env.DB, "SELECT archived_at FROM form_fields WHERE id = ?", [
        field!.id,
      ]),
    ).toEqual([{ archived_at: expect.any(String) }]);
  });

  it("rolls back when membership write permission is revoked after preflight", async () => {
    const definition = await getMembershipApplicationFormDefinition(env.DB);
    const actor = createUserBackedAuthAdmin({
      id: adminId,
      email: "admin@pkic.org",
      role: "admin",
      grants: [],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE users SET role = 'user' WHERE id = ?").bind(adminId).run(),
    );

    await expect(
      updateMembershipApplicationFormDefinition(racedDb, actor, {
        expectedUpdatedAt: definition.form.updatedAt,
        title: "This update must not persist",
      }),
    ).rejects.toMatchObject({ status: 409, code: "MEMBERSHIP_APPLICATION_FORM_AUTHORIZATION_CHANGED" });
    expect((await getMembershipApplicationFormDefinition(env.DB)).form.title).not.toBe("This update must not persist");
    expect(
      await queryAll(env.DB, "SELECT id FROM audit_log WHERE action = 'membership_application_form_updated'"),
    ).toHaveLength(0);
  });
});
