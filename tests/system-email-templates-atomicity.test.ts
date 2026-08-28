import { describe, expect, it, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { insertUser } from "./helpers/membership";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { gateBatchGroup } from "./helpers/d1-batch-gate";
import { queryAll } from "./helpers/context";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import {
  activateEmailTemplateVersion,
  createEmailTemplateVersion,
} from "../functions/_lib/services/email-template-management";
import { resetDb } from "./helpers/reset-db";
import { setupSystemTemplates } from "./helpers/system-email-templates";

describe("system email template atomicity", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects a template mutation when its staff permission is revoked before commit", async () => {
    await setupSystemTemplates();
    const staffId = await insertUser(env.DB, `email-template-toctou-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'email-templates:write', NULL, NULL, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, staffId)
      .run();
    const actor = createUserBackedAuthAdmin({
      id: staffId,
      email: "email-template-toctou@example.test",
      role: "user",
      scopes: [],
      grants: [{ permission: "email-templates:write", contextType: null, contextId: null }],
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?").bind(staffId).run(),
    );

    await expect(
      createEmailTemplateVersion(racedDb, actor, {
        templateKey: "permission_toctou",
        content: "Must not persist",
        contentType: "markdown",
      }),
    ).rejects.toMatchObject({ status: 409, code: "EMAIL_TEMPLATE_AUTHORIZATION_CHANGED" });
    expect(
      await queryAll(env.DB, "SELECT id FROM email_template_versions WHERE template_key = 'permission_toctou'"),
    ).toHaveLength(0);
  });

  it("rolls back activation when the staff permission is revoked before commit", async () => {
    await setupSystemTemplates();
    const staffId = await insertUser(env.DB, `email-template-activation-toctou-${crypto.randomUUID()}@example.test`);
    await env.DB.prepare(
      `INSERT INTO permission_grants
         (id, user_id, permission, context_type, context_id, granted_by_user_id, created_at)
       VALUES (?, ?, 'email-templates:write', NULL, NULL, ?, datetime('now'))`,
    )
      .bind(crypto.randomUUID(), staffId, staffId)
      .run();
    const actor = createUserBackedAuthAdmin({
      id: staffId,
      email: "email-template-activation-toctou@example.test",
      role: "user",
      scopes: [],
      grants: [{ permission: "email-templates:write", contextType: null, contextId: null }],
    });
    await createEmailTemplateVersion(env.DB, actor, {
      templateKey: "registration_confirm_email",
      content: "Activation must not persist",
      contentType: "markdown",
    });
    const racedDb = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE permission_grants SET revoked_at = datetime('now') WHERE user_id = ?").bind(staffId).run(),
    );

    await expect(activateEmailTemplateVersion(racedDb, actor, "registration_confirm_email", 2)).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_TEMPLATE_ACTIVATION_CONFLICT",
    });
    expect(
      await queryAll<{ version: number; status: string }>(
        env.DB,
        "SELECT version, status FROM email_template_versions WHERE template_key = ? ORDER BY version",
        "registration_confirm_email",
      ),
    ).toEqual([
      { version: 1, status: "active" },
      { version: 2, status: "draft" },
    ]);
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'email_template_version_activated' AND entity_type = 'email_template_version'",
      ),
    ).toHaveLength(0);
  });

  it("serializes concurrent creation of the next template version", async () => {
    await setupSystemTemplates();
    const [{ id: adminId, email }] = await queryAll<{ id: string; email: string }>(
      env.DB,
      "SELECT id, email FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const actor = createUserBackedAuthAdmin({ id: adminId, email, role: "admin", scopes: [] });
    const racedDb = gateBatchGroup(env.DB, 2);
    const results = await Promise.allSettled([
      createEmailTemplateVersion(racedDb, actor, {
        templateKey: "concurrent_creation",
        content: "First contender",
        contentType: "markdown",
      }),
      createEmailTemplateVersion(racedDb, actor, {
        templateKey: "concurrent_creation",
        content: "Second contender",
        contentType: "markdown",
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(
      await queryAll<{ version: number }>(
        env.DB,
        "SELECT version FROM email_template_versions WHERE template_key = 'concurrent_creation'",
      ),
    ).toEqual([{ version: 1 }]);
  });

  it("keeps one active version when activations race", async () => {
    await setupSystemTemplates();
    const [{ id: adminId, email }] = await queryAll<{ id: string; email: string }>(
      env.DB,
      "SELECT id, email FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
    );
    const actor = createUserBackedAuthAdmin({ id: adminId, email, role: "admin", scopes: [] });
    await createEmailTemplateVersion(env.DB, actor, {
      templateKey: "registration_confirm_email",
      content: "First racing activation version",
      contentType: "markdown",
    });
    await createEmailTemplateVersion(env.DB, actor, {
      templateKey: "registration_confirm_email",
      content: "Second racing activation version",
      contentType: "markdown",
    });
    const racedDb = gateBatchGroup(env.DB, 2);
    const results = await Promise.allSettled([
      activateEmailTemplateVersion(racedDb, actor, "registration_confirm_email", 2),
      activateEmailTemplateVersion(racedDb, actor, "registration_confirm_email", 3),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({
      status: 409,
      code: "EMAIL_TEMPLATE_ACTIVATION_CONFLICT",
    });
    expect(
      await queryAll(
        env.DB,
        "SELECT id FROM audit_log WHERE action = 'email_template_version_activated' AND entity_type = 'email_template_version'",
      ),
    ).toHaveLength(1);
    expect(
      await queryAll<{ active_count: number }>(
        env.DB,
        "SELECT COUNT(*) AS active_count FROM email_template_versions WHERE template_key = ? AND status = 'active'",
        "registration_confirm_email",
      ),
    ).toEqual([{ active_count: 1 }]);
  });
});
